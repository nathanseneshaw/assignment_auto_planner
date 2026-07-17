<script setup>
import { useScheduleBuilderStore } from '../../../stores/scheduleBuilder'
import { Button, Dropdown } from '../../ui'
import { meetingSummary } from '../../../utils/scheduleTime.js'

defineEmits(['apply'])

const builder = useScheduleBuilderStore()

const sortOptions = [
  { value: 'fewestDays', label: 'Fewest days on campus' },
  { value: 'leastGaps', label: 'Least gap time' },
  { value: 'earliestDone', label: 'Earliest done' },
  { value: 'latestStart', label: 'Latest start' },
]

function isPinned(section) {
  return builder.candidates.some(
    (c) => builder.candidateKey(c) === builder.candidateKey(section) && c.pinnedCrn === section.crn
  )
}

// Pin locks this exact section into every combo. Sections are already cached,
// so the immediate regenerate is instant.
function togglePin(section) {
  builder.setPin(builder.candidateKey(section), isPinned(section) ? null : section.crn)
  builder.generate()
}
</script>

<template>
  <div class="px-5 py-4 border-b border-paper-line dark:border-gray-700/60 space-y-3">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-surface dark:hover:bg-gray-800/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="builder.comboIndex === 0"
          aria-label="Previous schedule"
          @click="builder.comboIndex--"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span class="font-mono text-[12px] text-gray-600 dark:text-gray-300 tabular-nums whitespace-nowrap">
          Schedule {{ builder.comboIndex + 1 }} of {{ builder.combos.length }}
        </span>
        <button
          type="button"
          class="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-surface dark:hover:bg-gray-800/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          :disabled="builder.comboIndex >= builder.combos.length - 1"
          aria-label="Next schedule"
          @click="builder.comboIndex++"
        >
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <span v-if="builder.truncated" class="font-mono text-[11px] text-gray-400 dark:text-gray-500">
          showing first 200
        </span>
      </div>

      <div class="flex items-center gap-2">
        <div class="w-48">
          <Dropdown
            size="sm"
            :options="sortOptions"
            :model-value="builder.sortKey"
            @update:model-value="builder.setSortKey"
          />
        </div>
        <Button variant="primary" size="sm" @click="$emit('apply')">Apply</Button>
      </div>
    </div>

    <ul class="space-y-1">
      <li
        v-for="s in builder.previewSections"
        :key="s.crn"
        class="flex items-center justify-between gap-2"
      >
        <span class="min-w-0 truncate font-mono text-[12px] text-gray-600 dark:text-gray-300">
          <span class="font-semibold text-gray-900 dark:text-gray-100">{{ s.subjectCode }} {{ s.courseNumber }}</span>
          · {{ s.sectionNumber }} · {{ meetingSummary(s.meetings) }}<template v-if="s.instructors && s.instructors.length"> · {{ s.instructors.join(', ') }}</template>
        </span>
        <button
          type="button"
          class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-semibold border transition-colors"
          :class="isPinned(s)
            ? 'bg-primary-900 text-white border-primary-900'
            : 'bg-surface dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-800 dark:hover:text-gray-200'"
          :title="isPinned(s) ? 'Unpin this section' : 'Lock this section into every schedule'"
          @click="togglePin(s)"
        >
          <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 2 2 0 000-4H8a2 2 0 000 4 1 1 0 011 1z" />
          </svg>
          {{ isPinned(s) ? 'Pinned' : 'Pin' }}
        </button>
      </li>
    </ul>
  </div>
</template>
