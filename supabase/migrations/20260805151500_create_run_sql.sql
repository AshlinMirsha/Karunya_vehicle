create or replace function public.run_sql(query text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_result jsonb;
begin
  execute 'select jsonb_agg(t) from (' || query || ') t' into v_result;
  return v_result;
exception when others then
  return jsonb_build_object('error', SQLERRM);
end;
$$;
