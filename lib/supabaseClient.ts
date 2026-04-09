"use client"

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// This creates the single instance your page.tsx is looking for
export const supabase = createClient(supabaseUrl, supabaseKey)