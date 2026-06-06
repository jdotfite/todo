import { calendarModule } from './calendar/module.js';
import { documentsModule } from './documents/module.js';
import { groceryModule } from './grocery/module.js';
import { tasksModule } from './tasks/module.js';
import { tipsModule } from './tips/module.js';
import { chatModule } from './chat/module.js';

export const homeModule = {
  id: 'home',
  label: 'Home',
  navLabel: 'Home',
  href: '/home',
  icon: '🏠',
  profiles: ['family', 'justin', 'wife'],
  routes: ['/home'],
  apiBase: null,
};

export const settingsModule = {
  id: 'settings',
  label: 'Settings',
  navLabel: 'Settings',
  href: '/settings',
  icon: '⚙️',
  profiles: ['family', 'justin', 'wife'],
  routes: ['/settings'],
  apiBase: null,
};

export const modules = [
  homeModule,
  tasksModule,
  calendarModule,
  groceryModule,
  documentsModule,
  tipsModule,
  chatModule,
  settingsModule,
];

export const appPageRoutes = modules.flatMap(module => module.routes);

export function findModuleById(id) {
  return modules.find(module => module.id === id) || null;
}
