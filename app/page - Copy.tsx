'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ExcelJS from 'exceljs'

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [qtyMap, setQtyMap] = useState<{ [key: string]: any }>({})
  const [items, setItems] = useState<any[]>([])
  const [newItem, setNewItem] = useState('')
  const [transactions, setTransactions] = useState<any[]>([])
  const [unit, setUnit] = useState('')
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState('')

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (passwordInput === process.env.NEXT_PUBLIC_APP_PASSWORD) {
      setIsAuthenticated(true)
      localStorage.setItem('inventory_auth', 'true')
    } else { alert('Wrong password!') }
  }

  useEffect(() => {
    const auth = localStorage.getItem('inventory_auth')
    if (auth === 'true') setIsAuthenticated(true)
    fetchItems(); fetchTransactions()
  }, [])

  async function fetchItems() {
    const { data } = await supabase.from('items').select('*').order('name', { ascending: true })
    setItems(data || [])
  }

  async function fetchTransactions() {
    const { data } = await supabase
      .from('transactions')
      .select(`id, qty, type, created_at, item_id, items ( name, unit )`)
      .order('created_at', { ascending: false }).limit(30)
    setTransactions(data || [])
  }

  async function updateStock(itemId: string, qty: any) {
    const numQty = Number(qty);
    if (!numQty) return 
    const { error } = await supabase.rpc('update_stock', { item_id: itemId, qty: numQty })
    if (!error) { setQtyMap(prev => ({ ...prev, [itemId]: '' })); fetchItems(); fetchTransactions(); }
  }

  async function adjustStock(itemId: string, qty: any) {
    const numQty = Number(qty);
    if (isNaN(numQty) || qty === '') return;
    if (!confirm(`Set stock to exactly ${numQty}?`)) return;
    const { error } = await supabase.rpc('adjust_stock', { item_id: itemId, new_qty: numQty })
    if (!error) { setQtyMap(prev => ({ ...prev, [itemId]: '' })); fetchItems(); fetchTransactions(); }
  }

  async function exportReport() {
    if (!month) return alert('Select month first');
    const [year, monthStr] = month.split('-');
    const monthNum = parseInt(monthStr);
    const monthIdx = monthNum - 1;
    const daysInMonth = new Date(parseInt(year), monthNum, 0).getDate();
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const displayMonth = monthNames[monthIdx];
    const shortYear = year.slice(-2);

    const { data: allItems } = await supabase.from('items').select('*').order('name');
    
    // ✅ FIX: Added 'id' to the select query to resolve the TypeScript error
    const { data: allHistory } = await supabase.from('transactions')
      .select(`id, qty, type, created_at, item_id`)
      .order('created_at', { ascending: true });

    if (!allItems || !allHistory) return;

    const workbook = new ExcelJS.Workbook();
    
    // --- SHEET 1: DAILY MOVEMENT ---
    const sheet1 = workbook.addWorksheet('Daily Movement');
    const h1 = ['Number', 'Item Name', 'Initial Stock', 'Final Stock'];
    const h2 = ['', '', '', ''];
    for (let d = 1; d <= daysInMonth; d++) {
      h1.push(`${d.toString().padStart(2, '0')}-${displayMonth}-${shortYear}`, '');
      h2.push('In', 'Out');
    }
    sheet1.addRow(h1);
    sheet1.addRow(h2);

    sheet1.mergeCells('A1:A2'); sheet1.mergeCells('B1:B2');
    sheet1.mergeCells('C1:C2'); sheet1.mergeCells('D1:D2');
    for (let d = 0; d < daysInMonth; d++) {
      const col = 5 + (d * 2);
      sheet1.mergeCells(1, col, 1, col + 1);
    }

    const startOfMonth = `${month}-01T00:00:00Z`;
    const endOfMonth = `${month}-${daysInMonth}T23:59:59Z`;

    allItems.forEach((item, idx) => {
      const itemTrans = allHistory.filter(t => t.item_id === item.id);
      const preMonthTrans = itemTrans.filter(t => t.created_at < startOfMonth);
      const withinMonthTrans = itemTrans.filter(t => t.created_at >= startOfMonth && t.created_at <= endOfMonth);
      
      let initialStock = 0;

      if (preMonthTrans.length > 0) {
        initialStock = preMonthTrans.reduce((acc, t) => acc + t.qty, 0);
      } else if (withinMonthTrans.length > 0) {
        initialStock = withinMonthTrans[0].qty;
      }

      const netInMonth = withinMonthTrans.reduce((acc, t) => acc + t.qty, 0);
      const finalStock = preMonthTrans.length > 0 ? (initialStock + netInMonth) : netInMonth;

      const row = [idx + 1, item.name, initialStock, finalStock];
      for (let d = 1; d <= daysInMonth; d++) {
        const dStr = `${month}-${d.toString().padStart(2, '0')}`;
        const dayTrans = withinMonthTrans.filter(t => t.created_at.startsWith(dStr));
        
        // ✅ FIX: Checking id existence to prevent crashes
        const isFirstDayOfNewItem = preMonthTrans.length === 0 && dayTrans.length > 0 && dayTrans[0].id === withinMonthTrans[0]?.id;
        
        row.push(
          dayTrans.filter((t, i) => t.type === 'in' && !(isFirstDayOfNewItem && i === 0)).reduce((s, t) => s + t.qty, 0) || 0,
          dayTrans.filter(t => t.type === 'out' || (t.type === 'adjustment' && t.qty < 0)).reduce((s, t) => s + Math.abs(t.qty), 0) || 0
        );
      }
      
      const newRow = sheet1.addRow(row);
      if (finalStock <= 0) {
        newRow.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC0CB' } };
      }
    });

    // --- SHEET 2: ADJUSTMENT REPORT ---
    const sheet2 = workbook.addWorksheet('Adjustment Report');
    sheet2.addRow(['Date', 'Item Name', 'Difference Found', 'Status']);
    const monthAdj = allHistory.filter(t => t.type === 'adjustment' && t.created_at >= startOfMonth && t.created_at <= endOfMonth);
    
    monthAdj.forEach(t => {
      const itemName = allItems.find(i => i.id === t.item_id)?.name || 'Unknown';
      sheet2.addRow([new Date(t.created_at).toLocaleDateString(), itemName, t.qty > 0 ? `+${t.qty}` : t.qty, 'Stock Opname']);
    });

    [sheet1, sheet2].forEach(s => {
      s.eachRow((row) => {
        row.eachCell((cell) => {
          cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
          cell.alignment = { vertical:'middle', horizontal:'center' };
        });
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = window.URL.createObjectURL(blob);
    a.download = `Inventory_Report_${displayMonth}_${year}.xlsx`;
    a.click();
  }

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-xl shadow-lg w-full max-w-sm">
          <h2 className="text-2xl font-bold mb-4 text-center">Login</h2>
          <input type="password" placeholder="Password" className="border w-full p-3 rounded mb-4 outline-none" value={passwordInput} onChange={(e)=>setPasswordInput(e.target.value)} />
          <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded font-bold">Unlock</button>
        </form>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <button onClick={() => { localStorage.removeItem('inventory_auth'); setIsAuthenticated(false); }} className="text-xs text-red-400">Logout</button>
      </div>

      <div className="bg-white border p-4 rounded-xl shadow-sm mb-6 flex flex-wrap gap-4 items-end">
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Item Name" className="border p-2 rounded flex-1" />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="unit" className="border p-2 rounded w-20" />
        <button onClick={()=>{if(newItem){supabase.from('items').insert({name:newItem, stock:0, unit}).then(()=>{setNewItem('');setUnit('');fetchItems()})}}} className="bg-blue-600 text-white px-6 py-2 rounded font-bold">Add</button>
        <div className="ml-auto flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="border p-2 rounded" />
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border p-2 rounded" />
          <button onClick={exportReport} className="bg-green-600 text-white px-4 py-2 rounded font-bold">Excel Report</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {items.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).map((item) => (
          <div key={item.id} className={`bg-white border p-3 rounded-lg flex justify-between items-center ${item.stock === 0 ? 'border-red-500 bg-red-50' : ''}`}>
            <div>
              <span className="font-bold">{item.name}</span>
              <span className="ml-2 text-xs text-gray-400">({item.stock} {item.unit})</span>
            </div>
            <div className="flex gap-2">
              <input type="number" value={qtyMap[item.id] || ''} onChange={(e) => setQtyMap({...qtyMap, [item.id]: e.target.value})} className="border w-16 p-1 text-center rounded" placeholder="0" />
              <button onClick={() => updateStock(item.id, qtyMap[item.id])} className="bg-green-500 text-white px-3 py-1 rounded text-xs font-bold">IN</button>
              <button onClick={() => updateStock(item.id, -Math.abs(Number(qtyMap[item.id])))} className="bg-red-500 text-white px-3 py-1 rounded text-xs font-bold">OUT</button>
              <button onClick={() => adjustStock(item.id, qtyMap[item.id])} className="bg-amber-500 text-white px-3 py-1 rounded text-xs font-bold">ADJ</button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold mt-8 mb-3 text-gray-700">Recent Transactions</h2>
      <div className="bg-white border rounded-xl overflow-hidden">
        {transactions.map(t => {
          const itemRef = Array.isArray(t.items) ? t.items[0] : t.items;
          return (
            <div key={t.id} className="text-sm p-3 border-b last:border-0 flex justify-between items-center">
              <div className="flex flex-col">
                <span className="font-semibold text-gray-800">{itemRef?.name || 'Unknown'}</span>
                <span className="text-[10px] text-gray-400">{new Date(t.created_at).toLocaleString()}</span>
              </div>
              <span className={`font-bold px-3 py-1 rounded-lg text-xs ${t.type === 'in' ? 'bg-green-100 text-green-700' : t.type === 'adjustment' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                {t.type.toUpperCase()} {t.qty > 0 ? `+${t.qty}` : t.qty}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  )
}