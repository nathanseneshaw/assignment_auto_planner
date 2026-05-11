<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Sidebar from '../components/common/Sidebar.vue'
import TopBar from '../components/common/TopBar.vue'
import MobileNav from '../components/common/MobileNav.vue'

const sidebarOpen = ref(true)
const mobileMenuOpen = ref(false)
const isMobile = ref(false)

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
}

function openMobileSidebar() {
  mobileMenuOpen.value = true
}

function closeMobileSidebar() {
  mobileMenuOpen.value = false
}

function checkMobile() {
  isMobile.value = window.innerWidth < 1024
  if (!isMobile.value) {
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
  <div class="min-h-screen bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(71,85,105,0.06),transparent_50%),#fafafa]">
    <Sidebar 
      :open="sidebarOpen" 
      :mobile-open="mobileMenuOpen"
      @toggle="toggleSidebar" 
      @close-mobile="closeMobileSidebar"
    />
    
    <div 
      class="transition-all duration-300 min-h-screen flex flex-col"
      :class="sidebarOpen ? 'lg:pl-64' : 'lg:pl-20'"
    >
      <TopBar 
        @toggle-sidebar="toggleSidebar" 
        @open-mobile-sidebar="openMobileSidebar"
        :sidebar-open="sidebarOpen" 
      />
      
      <main class="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8">
        <div class="max-w-7xl mx-auto w-full">
          <slot />
        </div>
      </main>
    </div>

    <!-- Mobile Bottom Navigation -->
    <MobileNav />
  </div>
</template>
