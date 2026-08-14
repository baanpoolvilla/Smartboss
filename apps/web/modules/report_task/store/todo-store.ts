import { create } from "zustand";
import type { TodoItem } from "@/modules/report_task/types";

interface TodoStore {
  todos: TodoItem[];
  addTodo: (todo: TodoItem) => void;
  toggleTodo: (id: string) => void;
  removeTodo: (id: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "todos") in store-hydrator.tsx —
// shared across teammates, not per-browser, same as leaves/meetings.
export const useTodoStore = create<TodoStore>()((set) => ({
  todos: [],
  addTodo: (todo) => set((s) => ({ todos: [todo, ...s.todos] })),
  toggleTodo: (id) => set((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
  removeTodo: (id) => set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
}));
