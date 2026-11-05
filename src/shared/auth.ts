export type Outlet = {
  outlet_code: string;
  outlet_name: string;
  external_outlets: Array<{ code: string; name: string; group: string }>;
};
export type AuthUser = {
  id: number;
  name: string;
  mobile: string;
  outlets: Outlet[];
};
export type AuthState = { user: AuthUser | null; outlet: Outlet | null };
export type AuthResult =
  | { ok: true; session: AuthState }
  | {
      ok: false;
      error: string;
      confirmationRequired?: boolean;
    };
export type AuthApi = {
  getSession: () => Promise<AuthState>;
  refresh: () => Promise<AuthResult>;
  sendSms: (
    mobile: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  login: (mobile: string, code: string) => Promise<AuthResult>;
  chooseOutlet: (outletCode: string) => Promise<AuthResult>;
  logout: (confirmed?: boolean) => Promise<AuthResult>;
  onSession: (handler: (session: AuthState) => void) => () => void;
};
