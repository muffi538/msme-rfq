export function save(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function load<T>(key: string, defaultValue: T): T {
  const item = localStorage.getItem(key);
  if (item === null) return defaultValue;
  try {
    return JSON.parse(item) as T;
  } catch {
    return defaultValue;
  }
}
