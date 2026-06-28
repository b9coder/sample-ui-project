export interface ApplicationOption {
  value: string; // application_id
  label: string; // "Application-007 (Engineering)"
}

export interface UserOption {
  value: string; // ecn
  label: string; // "Alice Nelson (E100000) - Finance"
}

export async function fetchApplicationOptions(): Promise<ApplicationOption[]> {
  const res = await fetch("/api/applications");
  if (!res.ok) throw new Error(`Failed to load applications: ${res.status}`);
  const rows: {
    application_id: string;
    application_name: string;
    business_unit: string | null;
  }[] = await res.json();
  return rows.map((r) => ({
    value: r.application_id,
    label: r.business_unit ? `${r.application_name} (${r.business_unit})` : r.application_name,
  }));
}

export async function fetchUserOptions(): Promise<UserOption[]> {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error(`Failed to load users: ${res.status}`);
  const rows: {
    ecn: string;
    first_name: string;
    last_name: string;
    department: string | null;
  }[] = await res.json();
  return rows.map((r) => ({
    value: r.ecn,
    label: r.department
      ? `${r.first_name} ${r.last_name} (${r.ecn}) - ${r.department}`
      : `${r.first_name} ${r.last_name} (${r.ecn})`,
  }));
}
