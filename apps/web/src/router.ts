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

let sessionRestored = false

router.beforeEach(async (to) => {
  const session = useSessionStore()
  if (to.meta.requiresAuth === true && !sessionRestored) {
    sessionRestored = true
    await session.restore()
  }
  return session.routeFor(to.meta)
})
