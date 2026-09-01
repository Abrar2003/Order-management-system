const FILE_DELETE_PASSWORD = "ghs123";

export const confirmFileDeletion = (label = "this file") => {
  const password = window.prompt(`Enter the password to delete ${label}.`);
  if (password === null) return false;
  if (password === FILE_DELETE_PASSWORD) return true;
  window.alert("Incorrect password. File was not deleted.");
  return false;
};
