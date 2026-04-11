'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

export default function Home() {
  // --- AUTH & USER STATE ---
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [username, setUsername] = useState('') 
  const [password, setPassword] = useState('')

  // --- INVENTORY STATE ---
  const [items, setItems] = useState<any[]>([])
  const [qtyMap, setQtyMap] = useState<{ [key: string]: any }>({})
  const [newItem, setNewItem] = useState('')
  const [unit, setUnit] = useState('')
  const [transactions, setTransactions] = useState<any[]>([])
  
  // --- FILTER STATE ---
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState('')
  const [selectedDivision, setSelectedDivision] = useState<string>('all')
  const [allDivisions, setAllDivisions] = useState<any[]>([])
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editUnit, setEditUnit] = useState('');

  // 1. Initial Load
  useEffect(() => {
    checkUser()
  }, [])

  // 2. Refresh data when filters or user changes
  // Update your existing useEffect to look like this:
    useEffect(() => {
      // Only fetch if we have a user AND we know which divisions they are allowed to see
      if (user && profile && allDivisions.length > 0) {
        fetchItems()
        fetchTransactions()
      }
    }, [selectedDivision, profile, user, allDivisions]) // Add allDivisions to the dependency list

  async function handleLogin() {
    setLoading(true);
    let loginEmail = username.toLowerCase().trim();

    if (!loginEmail.includes('@')) {
      loginEmail = `${loginEmail}@aplusgroup.my.id`;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: password,
    });

    if (error) {
      alert("Login failed: " + error.message);
      setLoading(false);
    } else {
      window.location.reload();
    }
  }

 async function checkUser() {
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      setUser(null); setLoading(false); return;
    }
    setUser(user)

    const { data: prof } = await supabase
      .from('profiles')
      .select('*, restaurants(name)')
      .eq('id', user.id)
      .single()
    
    setProfile(prof)

    // --- CORRECTION STARTS HERE ---
    let divQuery = supabase
      .from('divisions')
      .select(`id, name, restaurant_id, restaurants!inner ( name )`)
    
    // 1. If user is restricted to ONE division, lock it here immediately
    if (prof?.division_id) {
      divQuery = divQuery.eq('id', prof.division_id)
    } 
    // 2. Otherwise, if they are staff but not restricted to a division, lock to restaurant
    else if (prof?.role !== 'super-admin' && prof?.restaurant_id) {
      divQuery = divQuery.eq('restaurant_id', prof.restaurant_id)
    }

    const { data: divs } = await divQuery
    const availableDivs = divs || []
    setAllDivisions(availableDivs)
    
    // 3. UI Logic: If they have exactly 1 division available, select it.
    if (availableDivs.length === 1) {
      setSelectedDivision(availableDivs[0].id)
    } else if (prof?.role !== 'super-admin' && availableDivs.length > 0) {
      setSelectedDivision(availableDivs[0].id)
    } else {
      setSelectedDivision('all')
    }
    // --- CORRECTION ENDS HERE ---
    
  } catch (err) {
    console.error("System Error:", err)
  } finally {
    setLoading(false)
  }
}
    async function fetchItems() {
    // 1. Safety Gate: Don't run if profile or divisions aren't loaded yet
    if (!profile || (profile.role !== 'super-admin' && allDivisions.length === 0)) {
      return;
    }
    
    let query = supabase
        .from('items')
        .select('*, divisions!inner(name, restaurant_id, restaurants(name))')
        .order('name')
    
    if (selectedDivision !== 'all') {
      query = query.eq('division_id', selectedDivision)
    } else if (profile.role !== 'super-admin') {
      // 2. Lock to the divisions we just loaded in checkUser
      const authorizedIds = allDivisions.map(d => d.id)
      query = query.in('division_id', authorizedIds)
    }

    const { data, error } = await query
    if (error) {
      console.error("Fetch Error:", error.message)
    } else {
      setItems(data || [])
    }
  }

  async function fetchTransactions() {
    if (!profile) return

    // Transactions table links to Items table via item_id
    let query = supabase
      .from('transactions')
      .select(`id, qty, type, created_at, item_id, items!inner ( name, unit, division_id )`)
      .order('created_at', { ascending: false })
      .limit(30)

    if (selectedDivision !== 'all') {
        query = query.eq('items.division_id', selectedDivision)
    } else if (profile.role !== 'super-admin') {
        // Staff only sees transactions for items belonging to their divisions
        const authorizedIds = allDivisions.map(d => d.id)
        query = query.in('items.division_id', authorizedIds)
    }

    const { data } = await query
    if (data) setTransactions(data)
  }

  async function addNewItem() {
    if (!newItem) return
    const targetDivision = selectedDivision !== 'all' ? selectedDivision : (profile.role === 'staff' ? allDivisions[0]?.id : null)
    
    if (!targetDivision) {
      return alert("Please select a specific Division (Dry/Wet/Frozen) first.")
    }

    const { error } = await supabase.from('items').insert({
      name: newItem,
      stock: 0,
      unit: unit,
      division_id: targetDivision
    })

    if (!error) {
      setNewItem(''); setUnit(''); fetchItems()
    } else {
      alert(error.message)
    }
  }

  async function updateStock(itemId: string, qty: any) {
    const numQty = Number(qty);
    if (!numQty) return 
    const { error } = await supabase.rpc('update_stock', { item_id: itemId, qty: numQty })
    if (!error) { 
        setQtyMap(prev => ({ ...prev, [itemId]: '' })); 
        fetchItems(); 
        fetchTransactions(); 
    } else {
        alert("Action failed: Check permissions.")
    }
  }

  async function adjustStock(itemId: string, qty: any) {
    const numQty = Number(qty);
    if (isNaN(numQty) || qty === '') return;
    if (!confirm(`Set stock to exactly ${numQty}?`)) return;
    const { error } = await supabase.rpc('adjust_stock', { item_id: itemId, new_qty: numQty })
    if (!error) { 
        setQtyMap(prev => ({ ...prev, [itemId]: '' })); 
        fetchItems(); 
        fetchTransactions(); 
    }
  }
  async function deleteItem(itemId: string, itemName: string) {
  if (!confirm(`WARNING: This will permanently delete "${itemName}" and ALL its transaction history. Proceed?`)) return;
  
  setLoading(true);
  const { error } = await supabase.rpc('force_delete_item', { target_item_id: itemId });
  
  if (!error) {
    fetchItems();
    fetchTransactions();
  } else {
    alert("Delete failed: " + error.message);
  }
  setLoading(false);
  }
  async function updateItem(itemId: string) {
    if (!editName.trim() || !editUnit.trim()) return alert("Fields cannot be empty");

    const { error } = await supabase
      .from('items')
      .update({ name: editName, unit: editUnit })
      .eq('id', itemId);

    if (!error) {
      setEditingId(null);
      fetchItems(); // Refresh the list to show new name/unit
    } else {
      alert("Update failed: " + error.message);
    }
  }

  async function exportReport() {
    if (!month) return alert('Select month first');
    setLoading(true);

    try {
      const [yearStr, monthStr] = month.split('-');
      const year = parseInt(yearStr);
      const monthIdx = parseInt(monthStr) - 1;
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
      
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Monthly Inventory');

      const { data: transData } = await supabase
        .from('transactions')
        .select('qty, type, created_at, item_id')
        .gte('created_at', `${month}-01`)
        .lt('created_at', monthIdx === 11 ? `${year + 1}-01-01` : `${year}-${String(monthIdx + 2).padStart(2, '0')}-01`);

      const currentDiv = allDivisions.find(d => d.id === selectedDivision);
      const currentDivName = currentDiv 
        ? `${currentDiv.restaurants?.name || 'Branch'} - ${currentDiv.name}` 
        : 'All Authorized Branches';
      
      worksheet.addRow([`INVENTORY REPORT: ${currentDivName} (${month})`]);
      worksheet.mergeCells(1, 1, 1, 6);
      worksheet.getRow(1).font = { bold: true, size: 14 };

      const headerRow2 = ['Number', 'Item Name', 'Restaurant', 'Division', 'Initial', 'Final'];
      const headerRow3 = ['', '', '', '', '', ''];

      for (let d = 1; d <= daysInMonth; d++) {
        const dateLabel = `${String(d).padStart(2, '0')}-${new Date(year, monthIdx).toLocaleString('en-us', { month: 'short' })}`;
        headerRow2.push(dateLabel, ''); 
        headerRow3.push('In', 'Out');
      }

      worksheet.addRow(headerRow2);
      worksheet.addRow(headerRow3);

      items.forEach((item, index) => {
        const rowData: any[] = [
          index + 1, 
          item.name, 
          item.divisions?.restaurants?.name || '-', 
          item.divisions?.name, 
          item.stock, 
          item.stock
        ];
        for (let d = 1; d <= daysInMonth; d++) {
          const dayIn = transData?.filter(t => t.item_id === item.id && new Date(t.created_at).getDate() === d && (t.type === 'in' || (t.type === 'adjustment' && t.qty > 0))).reduce((sum, t) => sum + Math.abs(t.qty), 0) || 0;
          const dayOut = transData?.filter(t => t.item_id === item.id && new Date(t.created_at).getDate() === d && (t.type === 'out' || (t.type === 'adjustment' && t.qty < 0))).reduce((sum, t) => sum + Math.abs(t.qty), 0) || 0;
          rowData.push(dayIn, dayOut);
        }
        worksheet.addRow(rowData);
      });

      // --- ADDED BORDER LOGIC START ---
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });
      // --- ADDED BORDER LOGIC END ---

      const buffer = await workbook.xlsx.writeBuffer();
      saveAs(new Blob([buffer]), `Aplus_Report_${month}.xlsx`);
    } catch (err) {
      console.error(err);
      alert("Export failed");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-400">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4"></div>
        <p className="font-bold text-sm">LOADING APLUS CONTROL...</p>
    </div>
  )

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm">
          <div className="text-center mb-8">
             <h2 className="text-3xl font-black text-blue-600 italic">APLUS</h2>
             <p className="text-gray-400 text-sm">Inventory System</p>
          </div>
          <div className="flex flex-col gap-4">
            <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} className="border p-2 rounded text-black outline-blue-500" />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="border p-2 rounded text-black outline-blue-500" />
            <button onClick={handleLogin} className="bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700">Login</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-6xl mx-auto min-h-screen bg-gray-50">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 bg-white p-4 rounded-xl shadow-sm border">
        <div>
          <h1 className="text-xl font-bold text-gray-800">
             {profile?.role === 'super-admin' ? 'HQ Master Controller' : `${profile?.restaurants?.name || 'Branch'} Dashboard`}
          </h1>
          <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">
            User: <span className="text-blue-600">{profile?.username}</span>
          </p>
        </div>
        <button onClick={async () => { await supabase.auth.signOut(); window.location.href = "/"; }} className="bg-gray-100 hover:bg-red-50 text-red-500 px-4 py-2 rounded-lg text-sm font-medium">Logout</button>
      </div>

      {/* Control Panel */}
      <div className="bg-white border p-6 rounded-xl shadow-sm mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-end">
          
          <div className="lg:col-span-4">
            <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase tracking-widest">Quick Add Item</label>
            <div className="flex gap-2">
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Name" className="border p-2.5 rounded-lg flex-1 text-sm bg-gray-50 outline-blue-500 text-black" />
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" className="border p-2.5 rounded-lg w-20 text-sm bg-gray-50 outline-blue-500 text-black" />
              <button onClick={addNewItem} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm">Add</button>
            </div>
          </div>

          <div className="lg:col-span-8 flex flex-wrap md:flex-nowrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase tracking-widest">Select Branch/Dept</label>
              <select 
                className="w-full bg-yellow-50 border border-yellow-200 p-2.5 rounded-lg text-sm font-bold text-yellow-700 outline-none"
                value={selectedDivision}
                onChange={(e) => setSelectedDivision(e.target.value)}
              >
                {/* Only Super Admin can see 'Global View' */}
                {profile?.role === 'super-admin' && <option value="all">🌐 GLOBAL VIEW (All Branches)</option>}
                
                {allDivisions.map((div) => (
                  <option key={div.id} value={div.id}>
                    📍 {div.restaurants?.name} - {div.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-w-[150px]">
              <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase tracking-widest">Search</label>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="w-full border p-2.5 rounded-lg text-sm bg-gray-50 outline-blue-500 text-black" />
            </div>

            <div className="flex-none">
              <label className="block text-[10px] font-black text-gray-400 mb-2 uppercase tracking-widest">Report</label>
              <div className="flex gap-1">
                <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border p-2.5 rounded-lg text-sm bg-gray-50 outline-blue-500 text-black" />
                <button onClick={exportReport} className="bg-green-600 text-white px-4 py-2.5 rounded-lg font-bold text-sm">Excel</button>
              </div>
            </div>
          </div>
        </div>
      </div>

        {/* Item List */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {items.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).map((item: any) => (
            <div key={item.id} className="bg-white border p-4 rounded-xl flex flex-col gap-3 shadow-sm hover:shadow-md transition-all">
              <div className="flex justify-between items-start">
                <div className="w-full">
                  {editingId === item.id ? (
                    /* EDIT MODE: Show Input Boxes */
                    <div className="flex flex-col gap-2 mb-2">
                      <input 
                        className="border p-1 rounded text-sm font-bold w-full text-black outline-blue-500"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <input 
                        className="border p-1 rounded text-xs w-20 text-black outline-blue-500"
                        value={editUnit}
                        onChange={(e) => setEditUnit(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => updateItem(item.id)} className="text-[10px] bg-blue-600 text-white px-2 py-1 rounded font-bold">Save</button>
                        <button onClick={() => setEditingId(null)} className="text-[10px] bg-gray-400 text-white px-2 py-1 rounded font-bold">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    /* VIEW MODE: Show Text + Edit Button */
                    <div className="flex items-center gap-2">
                      <div className="font-bold text-gray-800 text-lg leading-tight uppercase">{item.name}</div>
                      
                      {profile?.role === 'super-admin' && (
                        <div className="flex gap-1">
                          {/* EDIT BUTTON */}
                          <button 
                            onClick={() => {
                              setEditingId(item.id);
                              setEditName(item.name);
                              setEditUnit(item.unit);
                            }}
                            className="text-blue-400 hover:text-blue-600 p-1 transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>

                          {/* DELETE BUTTON */}
                          <button onClick={() => deleteItem(item.id, item.name)} className="text-red-300 hover:text-red-600 p-1 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Division Label - Inside the same div so it stays left-aligned */}
                  {editingId !== item.id && (
                    <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mt-1">
                       {item.divisions?.restaurants?.name} — {item.divisions?.name}
                    </div>
                  )}
                </div>

                {/* STOCK DISPLAY - Right Aligned */}
                {editingId !== item.id && (
                  <div className="text-2xl font-black text-blue-600 ml-2">
                    {item.stock} <span className="text-xs font-normal text-gray-400">{item.unit}</span>
                  </div>
                )}
              </div>
              
              {/* Transaction Input Area */}
              <div className="flex gap-1 items-center bg-gray-50 p-2 rounded-lg mt-auto">
                <input type="number" value={qtyMap[item.id] || ''} onChange={(e) => setQtyMap({...qtyMap, [item.id]: e.target.value})} className="border w-full p-2 text-center rounded-lg font-bold outline-blue-500 text-black" placeholder="Qty" />
                <button onClick={() => updateStock(item.id, qtyMap[item.id])} className="bg-green-500 text-white px-3 py-2 rounded-lg text-xs font-bold">IN</button>
                <button onClick={() => updateStock(item.id, -Math.abs(Number(qtyMap[item.id])))} className="bg-red-500 text-white px-3 py-2 rounded-lg text-xs font-bold">OUT</button>
                
                {(profile?.role === 'super-admin' || ['aplus', 'harsa', 'titanium'].includes(profile?.username)) && (
                  <button 
                    onClick={() => adjustStock(item.id, qtyMap[item.id])} 
                    className="bg-amber-500 text-white px-3 py-2 rounded-lg text-xs font-bold"
                  >
                    ADJ
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

      {/* Activity Feed */}
      <div className="mt-10 mb-20">
        <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest mb-4">
          {search ? `Activity for "${search}"` : 'Recent Activity'}
        </h2>
        <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
          {/* Filter transactions based on the search box */}
          {transactions
            .filter((t: any) => {
              const itemRef = Array.isArray(t.items) ? t.items[0] : t.items;
              // If there is no search, show all. If there is, match item name.
              return !search || itemRef?.name?.toLowerCase().includes(search.toLowerCase());
            })
            .length === 0 && (
              <p className="p-8 text-center text-gray-400 text-sm italic">No matching transactions.</p>
            )}

          {/* Map through the FILTERED list */}
          {transactions
            .filter((t: any) => {
              const itemRef = Array.isArray(t.items) ? t.items[0] : t.items;
              return !search || itemRef?.name?.toLowerCase().includes(search.toLowerCase());
            })
            .map((t: any) => {
              const itemRef = Array.isArray(t.items) ? t.items[0] : t.items;
              return (
                <div key={t.id} className="text-sm p-4 border-b last:border-0 flex justify-between items-center hover:bg-gray-50">
                  <div className="flex flex-col">
                    <span className="font-bold text-gray-700">{itemRef?.name || 'Unknown Item'}</span>
                    <span className="text-[10px] text-gray-400">{new Date(t.created_at).toLocaleString()}</span>
                  </div>
                  <span className={`font-black px-3 py-1 rounded-full text-[10px] ${t.type === 'in' ? 'bg-green-100 text-green-700' : t.type === 'adjustment' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                    {t.type.toUpperCase()} {t.qty > 0 ? `+${t.qty}` : t.qty}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  )
}