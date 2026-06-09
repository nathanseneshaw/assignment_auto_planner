<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Sidebar from '../common/Sidebar.vue'
import TopBar from '../common/TopBar.vue'
import MobileNav from '../common/MobileNav.vue'
import FeedbackModal from '../features/FeedbackModal.vue'

const showFeedback = ref(false)
const mobileMenuOpen = ref(false)

function openMobileSidebar() {
  mobileMenuOpen.value = true
}

function closeMobileSidebar() {
  mobileMenuOpen.value = false
}

function checkMobile() {
  if (window.innerWidth >= 1024) {
    mobileMenuOpen.value = false
  }
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})
</script>

<template>
  <div class="main-layout-bg min-h-screen">
    <Sidebar
      :mobile-open="mobileMenuOpen"
      @close-mobile="closeMobileSidebar"
    />

    <div class="min-h-screen flex flex-col lg:pl-64">
      <TopBar @open-mobile-sidebar="openMobileSidebar" />

      <main class="flex-1 px-4 sm:px-8 lg:px-12 pb-24 lg:pb-12">
        <div class="max-w-6xl mx-auto w-full">
          <slot />
        </div>
      </main>
    </div>

    <!-- Mobile Bottom Navigation -->
    <MobileNav />

    <!-- Feedback Button -->
    <button
      type="button"
      @click="showFeedback = true"
      class="fixed bottom-[5.5rem] right-4 lg:bottom-6 lg:right-6 z-40 inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface dark:bg-gray-800 border border-gray-200/90 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-[13px] font-semibold shadow-sm shadow-gray-900/8 hover:bg-gray-50 dark:hover:bg-gray-700/80 hover:text-gray-900 dark:hover:text-gray-100 hover:border-gray-300 dark:hover:border-gray-600 transition-all duration-200 active:scale-[0.97]"
    >
      <svg class="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
      </svg>
      Feedback
    </button>

    <FeedbackModal v-model="showFeedback" />
  </div>
</template>
