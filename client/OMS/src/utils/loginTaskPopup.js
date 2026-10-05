export const getRemainingTasks = (tasks = []) =>
  (Array.isArray(tasks) ? tasks : []).filter((task) => Number(task?.pending_count) > 0);
