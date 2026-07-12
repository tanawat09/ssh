import { createRouter, createWebHistory } from 'vue-router'

import { useSessionStore } from './stores/session'
import CreateServerView from './views/CreateServerView.vue'
import LoginView from './views/LoginView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/servers/new' },
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/servers/new',
      name: 'create-server',
      component: CreateServerView,
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach((to) => useSessionStore().routeFor(to.meta))
