// The Supabase project behind Benchmark. The anon key is meant to be public:
// row-level security rules in the database protect everyone's data.
export const CONFIG = {
  supabaseUrl: 'https://rnujzhrfiqjfjqskekpt.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJudWp6aHJmaXFqZmpxc2tla3B0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NTA3MjQsImV4cCI6MjEwNjIyNjcyNH0.dZKyi8kB9uE_uqpLBFOx35ZzLkMm0xSI-qZRNy3k6u0',
  imageBase: 'https://assets.tcgdex.net',
  // Google sign-in runs on the page itself (Google Identity Services), so Google's window names Benchmark
  // and benchmarktcg.us instead of the Supabase address. Public value; the same client Supabase uses.
  googleClientId: '372317371898-pa480kss1hccqgbefb3vccfe5kovn8bc.apps.googleusercontent.com',
  // Sites listed as Authorized JavaScript origins on that Google client. Anywhere else uses the redirect flow.
  googleOrigins: ['https://benchmarktcg.us', 'https://www.benchmarktcg.us'],
};
