export const normalizeUserRole = (role) =>
  String(role || "").trim().toLowerCase();

export const isViewOnlyUserRole = (role) =>
  normalizeUserRole(role) === "user";

export const isViewOnlyUser = (user) => isViewOnlyUserRole(user?.role);
