/* Collegamento al database della lega (Supabase).
 * Questi due valori sono pubblici per scelta: le protezioni stanno nelle policy
 * del database, non nella chiave. La chiave "service_role" non va MAI messa qui. */
window.SCHIERA_CONFIG = {
  url: 'https://digonsptxuawnehebotw.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZ29uc3B0eHVhd25laGVib3R3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNTU1OTYsImV4cCI6MjEwNTczMTU5Nn0.wVbu4qEJO6CGkbBaSGLRL-l6qooNoUyHZC5TiqJAhrA'
};
