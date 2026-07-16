import { createRouter, createWebHistory } from 'vue-router'

import { useSessionStore } from './stores/session'
import CreateServerView from './views/CreateServerView.vue'
import LoginView from './views/LoginView.vue'
import ServerListView from './views/ServerListView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/servers' },
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/servers',
      name: 'servers',
      component: ServerListView,
      meta: { requiresAuth: true },
    },
    {
      path: '/servers/new',
      name: 'create-server',
      component: CreateServerView,
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach((to) => useSessionStore().routeFor(to.meta))
