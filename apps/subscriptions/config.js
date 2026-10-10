// Supabase project for cloud sync (optional). The anon/publishable key is meant to be
// public: row level security (supabase/schema.sql) keeps each user's rows private.
// Leave empty to configure it from Ajustes on each device instead.
globalThis.SUBS_SUPABASE = {
  url: "",
  anonKey: "",
};
