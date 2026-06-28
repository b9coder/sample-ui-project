export type Backend = "sqlite" | "postgres" | "sqlserver" | "starburst";

export interface ApplicationRow {
  application_id: string;
  application_name: string;
  business_unit: string | null;
  environment: string | null;
  owner_ecn: string | null;
  description: string | null;
}

export interface UserRow {
  ecn: string;
  first_name: string;
  last_name: string;
  email: string | null;
  band: string | null;
  department: string | null;
  role: string | null;
}

export interface Conversation {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationsSource {
  listApplications(): Promise<ApplicationRow[]>;
}

export interface UsersSource {
  listUsers(): Promise<UserRow[]>;
}

export interface ConversationsSource {
  list(): Promise<Conversation[]>;
  create(name?: string): Promise<Conversation>;
  rename(id: string, name: string): Promise<Conversation | null>;
  touch(id: string): Promise<void>;
  delete(id: string): Promise<boolean>;
}
