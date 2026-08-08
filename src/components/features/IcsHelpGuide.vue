<script setup>
/**
 * "Where do I find my ICS link?" helper.
 *
 * Renders a small, unobtrusive trigger (a "?" pill) that sits next to the feed
 * manager. Opening it reveals a modal that, rather than dumping every provider's
 * instructions at once, first asks *which* tool the user is copying the link
 * from, then shows just that provider's steps. A back arrow returns to the
 * picker so users can hop between providers without closing the modal.
 */
import { ref, watch, computed } from 'vue'
import { Modal } from '../ui'
import canvasLogo from '../../assets/tool-logos/canvas.svg'
import blackboardLogo from '../../assets/tool-logos/blackboard.svg'
import brightspaceLogo from '../../assets/tool-logos/brightspace.svg'
import googleCalendarLogo from '../../assets/tool-logos/googlecalendar.svg'

const open = ref(false)

// null → show the provider picker; a key → show that provider's steps.
const selected = ref(null)

// Each provider: its brand logo, a one-line picker subtitle, and the exact
// numbered steps to reach the calendar link. `pad` tunes how the logo sits in
// its tile - the square app icons get breathing room; the D2L wordmark already
// carries its own padding so it sits closer to the edges.
const GUIDES = [
  {
    key: 'canvas',
    name: 'Canvas',
    subtitle: 'Calendar Feed link',
    logo: canvasLogo,
    pad: 'p-1.5',
    steps: [
      'Open Canvas and click "Calendar" in the far-left menu.',
      'On the calendar, scroll to the bottom of the sidebar on the right side and click "Calendar Feed".',
      'A box appears with a link ending in .ics. Copy the entire link.',
    ],
  },
  {
    key: 'blackboard',
    name: 'Blackboard',
    subtitle: 'Share Calendar link',
    logo: blackboardLogo,
    pad: 'p-1.5',
    steps: [
      'From the main menu, click the "Calendar" button in the left sidebar.',
      'At the top-right of the calendar page, click the gear (settings) icon.',
      'Click the three-dots menu button.',
      'Choose "Share Calendar", then copy the link shown (it ends in .ics).',
    ],
    note: 'If you do not see this option, your school may have the feed turned off. Ask your instructor or IT help desk.',
  },
  {
    key: 'brightspace',
    name: 'Brightspace',
    subtitle: 'Enable feeds then Subscribe (D2L)',
    logo: brightspaceLogo,
    pad: 'p-1',
    steps: [
      'Log in to Brightspace and open the "Calendar" tool (some schools label it "Upcoming/Recorded Events").',
      'At the top of the calendar, click "Settings".',
      'Check "Enable Calendar Feeds", then click "Save".',
      'Back on the calendar, click "Subscribe".',
      'Copy the iCal feed link it shows you (it ends in .ics).',
    ],
    note: 'If you do not see the "Enable Calendar Feeds" option, your school may have feeds turned off. Ask your instructor or IT help desk.',
  },
  {
    key: 'google',
    name: 'Google Calendar',
    subtitle: 'Secret address in iCal format',
    logo: googleCalendarLogo,
    pad: 'p-1.5',
    steps: [
      'Open Google Calendar in a browser, click the gear icon at the top, then choose "Settings".',
      'Under "Settings for my calendars", select the calendar you want to export.',
      'Scroll down to the "Integrate calendar" section.',
      'Copy the "Secret address in iCal format" (it ends in .ics). Keep this link private.',
    ],
  },
]

const activeGuide = computed(() => GUIDES.find((g) => g.key === selected.value) || null)

// Reset to the picker whenever the modal is (re)opened so it never lands on a
// previously viewed provider's steps.
watch(open, (isOpen) => {
  if (isOpen) selected.value = null
})
</script>

<template>
  <!-- Trigger: quiet "?" pill that reads as help, not another action to take. -->
  <button
    type="button"
    class="group inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-primary-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 rounded-full"
    @click="open = true"
  >
    <span
      class="w-4 h-4 rounded-full border border-current inline-flex items-center justify-center text-[10px] font-bold leading-none"
      aria-hidden="true"
    >?</span>
    Where do I find my ICS link?
  </button>

  <Modal v-model="open" size="lg" title="Find your calendar (ICS) link">
    <!-- ── Provider picker ── -->
    <div v-if="!activeGuide">
      <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-4">
        Pick the tool you get your assignments from and we'll show you exactly where its
        calendar link lives.
      </p>

      <div class="divide-y divide-paper-line dark:divide-gray-700/50">
        <button
          v-for="guide in GUIDES"
          :key="guide.key"
          type="button"
          class="group w-full flex items-center gap-3.5 py-3.5 text-left transition-colors hover:bg-surface/60 dark:hover:bg-gray-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/30 rounded-lg -mx-2 px-2"
          @click="selected = guide.key"
        >
          <!-- Brand logo -->
          <div
            class="w-10 h-10 rounded-xl shrink-0 overflow-hidden flex items-center justify-center bg-white border border-paper-line dark:border-gray-600/60"
          >
            <img :src="guide.logo" :alt="`${guide.name} logo`" class="w-full h-full object-contain" :class="guide.pad" />
          </div>

          <div class="flex-1 min-w-0">
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {{ guide.name }}
            </p>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">
              {{ guide.subtitle }}
            </p>
          </div>

          <span
            aria-hidden="true"
            class="shrink-0 pr-1 text-gray-300 dark:text-gray-600 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors"
          >→</span>
        </button>
      </div>

      <p class="text-[12px] text-gray-400 dark:text-gray-500 leading-relaxed mt-4">
        Your ICS link is private to you. Once you have it, paste it into "Add feed" and Plannr
        keeps your assignments in sync automatically.
      </p>
    </div>

    <!-- ── A single provider's steps ── -->
    <div v-else>
      <!-- Back to the picker -->
      <button
        type="button"
        class="inline-flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 transition-colors mb-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400/30 rounded"
        @click="selected = null"
      >
        <span aria-hidden="true">←</span> All tools
      </button>

      <!-- Provider header -->
      <div class="flex items-center gap-3 mb-5">
        <div
          class="w-10 h-10 rounded-xl shrink-0 overflow-hidden flex items-center justify-center bg-white border border-paper-line dark:border-gray-600/60"
        >
          <img :src="activeGuide.logo" :alt="`${activeGuide.name} logo`" class="w-full h-full object-contain" :class="activeGuide.pad" />
        </div>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-snug">
            {{ activeGuide.name }}
          </p>
          <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">
            {{ activeGuide.subtitle }}
          </p>
        </div>
      </div>

      <!-- Numbered steps -->
      <ol class="space-y-3.5">
        <li
          v-for="(step, i) in activeGuide.steps"
          :key="i"
          class="flex gap-3"
        >
          <span
            class="w-5 h-5 shrink-0 rounded-full bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300 text-[11px] font-semibold inline-flex items-center justify-center mt-0.5 select-none"
            aria-hidden="true"
          >{{ i + 1 }}</span>
          <span class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{{ step }}</span>
        </li>
      </ol>

      <!-- Provider-specific caveat -->
      <p
        v-if="activeGuide.note"
        class="text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed mt-5 pl-3 border-l-2 border-paper-line dark:border-gray-700/60"
      >
        {{ activeGuide.note }}
      </p>
    </div>
  </Modal>
</template>
