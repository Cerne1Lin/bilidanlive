import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
    {
        path: '/',
        name: 'Home',
        component: () => import('../views/Home.vue'),
        meta: { index: 0 },
    },
    {
        path: '/personal',
        name: 'Personal',
        component: () => import('../views/Personal.vue'),
        meta: { index: 1 },
    },
    {
        path: '/setting',
        name: 'Setting',
        component: () => import('../views/Setting.vue'),
        meta: { index: 2 },
    }
]

const router = createRouter({
    history: createWebHashHistory(),
    routes
})

export default router