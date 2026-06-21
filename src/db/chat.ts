import { supabase } from "./supabase";

export interface SavedQuery {
  id: string;
  brand_id: string;
  client_id: string;
  user_id: string | null;
  name: string;
  query_text: string;
  plan_snapshot: Record<string, unknown> | null;
  schedule: string | null;
  max_leads: number;
  auto_approve_threshold: number | null;
  is_active: boolean;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createSavedQuery(
  query: Omit<SavedQuery, "id" | "created_at" | "updated_at" | "last_run_at">,
): Promise<SavedQuery> {
  const { data, error } = await supabase
    .from("saved_queries")
    .insert(query)
    .select()
    .single();

  if (error) throw new Error(`Failed to create saved query: ${error.message}`);
  return data;
}

export async function getSavedQueries(
  brandId: string,
  activeOnly = false,
): Promise<SavedQuery[]> {
  let q = supabase
    .from("saved_queries")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (activeOnly) q = q.eq("is_active", true);

  const { data, error } = await q;
  if (error) throw new Error(`Failed to get saved queries: ${error.message}`);
  return data ?? [];
}

export async function getActiveScheduledQueries(): Promise<SavedQuery[]> {
  const { data, error } = await supabase
    .from("saved_queries")
    .select("*")
    .eq("is_active", true)
    .not("schedule", "is", null);

  if (error) throw new Error(`Failed to get scheduled queries: ${error.message}`);
  return data ?? [];
}

export async function updateSavedQuery(
  id: string,
  updates: Partial<SavedQuery>,
): Promise<void> {
  const { error } = await supabase
    .from("saved_queries")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`Failed to update saved query: ${error.message}`);
}

export async function deleteSavedQuery(id: string): Promise<void> {
  const { error } = await supabase.from("saved_queries").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete saved query: ${error.message}`);
}

export async function markSavedQueryRun(id: string): Promise<void> {
  const { error } = await supabase
    .from("saved_queries")
    .update({ last_run_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(`Failed to mark query run: ${error.message}`);
}
