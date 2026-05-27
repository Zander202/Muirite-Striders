import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://hfkudpsqkuqsrdorchom.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhma3VkcHNxa3Vxc3Jkb3JjaG9tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5Mjk3ODYsImV4cCI6MjA5NDUwNTc4Nn0.DS_6GQ6XUGU3SpsUm4xszh1WKuBMvJxzV8boWnTpI-Y";

export const supabase = createClient(supabaseUrl, supabaseKey);