<script setup>
import { computed } from 'vue'
import { useCoursePlannerStore } from '../../../stores/coursePlanner'
import { useScheduleBuilderStore } from '../../../stores/scheduleBuilder'
import { Button, Checkbox, TimePicker } from '../../ui'
import { DAYS } from '../../../utils/scheduleTime.js'
import { groupSectionsByCourse } from '../../../utils/sectionAvailability.js'

const planner = useCoursePlannerStore()
const builder = useScheduleBuilderStore()

// One row per course in the currently loaded subject; the "Add" button hands
// the group's first section to the store, which derives the candidate from it.
// Built from visibleSections so a course whose every section is full or closed
// never becomes a candidate — the generator would only report it back as an
// empty slot and produce zero schedules.
const courseGroups = computed(() => groupSectionsByCourse(planner.visibleSections))

// Courses the availability preference is holding back from this subject.
const hiddenCourseCount = computed(() => {
  if (!planner.hideUnavailable) return 0
  return groupSectionsByCourse(planner.sections).filter((g) => g.available === 0).length
})

function toggleDayOff(code) {
  const days = builder.filters.daysOff.includes(code)
    ? builder.filters.daysOff.filter((d) => d !== code)
    : [...builder.filters.daysOff, code]
  builder.setFilters({ daysOff: days })
}

function emptySlotMessage(slot) {
  if (slot.reason === 'filtered-out') return `${slot.label} has no sections left after filters.`
  return `${slot.label} has no sections in this term.`
}

const showNoCombosMessage = computed(
  () => builder.generated && !builder.combos.length && !builder.emptySlots.length && !builder.errors.sections
)
</script>

<template>
  <div class="mt-3 flex-1 min-h-0 overflow-y-auto pr-1 space-y-5 max-h-[70vh] lg:max-h-none">
    <!-- Candidates -->
    <div class="rounded-2xl border border-primary-200/60 dark:border-primary-800/40 bg-primary-50/50 dark:bg-primary-900/15 p-4">
      <div class="flex items-center justify-between mb-2.5">
        <p class="eyebrow text-gray-400 dark:text-gray-500">
          Courses <span class="text-gray-300 dark:text-gray-600 tabular-nums">· {{ builder.candidates.length }}/8</span>
        </p>
        <button
          v-if="builder.candidates.length"
          type="button"
          class="eyebrow text-rust-600 dark:text-rust-500 hover:text-rust-700 dark:hover:text-rust-400 transition-colors"
          @click="builder.clearCandidates()"
        >
          Clear
        </button>
      </div>

      <p v-if="!builder.candidates.length" class="font-serif italic text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
        Pick up to 8 courses below. The builder finds every conflict-free schedule.
      </p>

      <ul v-else class="space-y-2">
        <li
          v-for="c in builder.candidates"
          :key="builder.candidateKey(c)"
          class="rounded-xl border border-paper-line dark:border-gray-700/60 bg-surface/50 dark:bg-gray-800/30 p-2.5 flex items-start justify-between gap-2"
        >
          <div class="min-w-0">
            <p class="font-semibold text-[13px] text-gray-900 dark:text-gray-100">
              {{ c.subjectCode }} {{ c.courseNumber }}
            </p>
            <p class="font-serif text-[13px] text-gray-600 dark:text-gray-300 truncate">{{ c.title }}</p>
            <!-- Read-only indicator; pinning is managed from the calendar's combo rows. -->
            <p v-if="c.pinnedCrn" class="mt-0.5 font-mono text-[11px] text-primary-600 dark:text-primary-400">
              Pinned · CRN {{ c.pinnedCrn }}
            </p>
          </div>
          <button
            type="button"
            class="p-1 shrink-0 text-gray-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 rounded-lg transition-colors"
            title="Remove course"
            @click="builder.removeCandidate(builder.candidateKey(c))"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </li>
      </ul>
    </div>

    <!-- Add courses from the loaded subject -->
    <div class="rounded-2xl border border-primary-200/50 dark:border-primary-800/30 bg-surface/40 dark:bg-gray-800/30 p-4">
      <p class="eyebrow text-gray-400 dark:text-gray-500 mb-2.5">Add courses</p>

      <p v-if="planner.loading.sections" class="py-4 text-center font-mono text-[12px] text-gray-400 dark:text-gray-500">
        Loading sections…
      </p>
      <p v-else-if="planner.errors.sections" class="py-4 text-center text-sm text-rust-600 dark:text-rust-500">
        {{ planner.errors.sections }}
      </p>
      <p v-else-if="!planner.selectedSubjectCode" class="font-serif italic text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
        Pick a term + subject above, then add courses from the list here.
      </p>
      <template v-else-if="!courseGroups.length">
        <p v-if="hiddenCourseCount" class="font-serif italic text-[14px] text-gray-500 dark:text-gray-400 leading-relaxed">
          Every course in this subject is full or closed.
        </p>
        <p v-else class="font-serif italic text-[14px] text-gray-500 dark:text-gray-400">
          No courses in this subject.
        </p>
      </template>

      <ul v-else class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        <li
          v-for="g in courseGroups"
          :key="g.courseNumber"
          class="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-surface dark:hover:bg-gray-800/60 transition-colors"
        >
          <div class="min-w-0">
            <p class="text-[13px] text-gray-800 dark:text-gray-200 truncate">
              <span class="font-semibold">{{ g.first.subjectCode }} {{ g.first.courseNumber }}</span>
              <span class="text-gray-500 dark:text-gray-400"> - {{ g.first.title }}</span>
            </p>
            <p class="font-mono text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
              {{ g.sections.length }} {{ g.sections.length === 1 ? 'section' : 'sections' }}
            </p>
          </div>
          <Button
            v-if="!builder.isCandidate(g.first)"
            variant="secondary"
            size="sm"
            class="shrink-0"
            :disabled="!builder.canAddMore"
            @click="builder.addCandidate(g.first)"
          >
            Add
          </Button>
          <span v-else class="shrink-0 font-mono text-[11px] text-primary-600 dark:text-primary-400">Added</span>
        </li>
      </ul>
      <p v-if="hiddenCourseCount" class="mt-2 font-mono text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">
        {{ hiddenCourseCount }} {{ hiddenCourseCount === 1 ? 'course' : 'courses' }} with no open sections hidden
      </p>
      <p v-if="!builder.canAddMore" class="mt-2 font-mono text-[11px] text-gray-400 dark:text-gray-500">
        Course limit reached (8).
      </p>
    </div>

    <!-- Filters -->
    <div class="rounded-2xl border border-primary-200/50 dark:border-primary-800/30 bg-surface/40 dark:bg-gray-800/30 p-4 space-y-4">
      <p class="eyebrow text-gray-400 dark:text-gray-500">Filters</p>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <label class="eyebrow text-gray-500 dark:text-gray-400">No classes before</label>
          <TimePicker
            size="sm"
            placeholder="Any time"
            :model-value="builder.filters.earliestStart"
            @update:model-value="builder.setFilters({ earliestStart: $event })"
          />
        </div>
        <div class="space-y-1.5">
          <label class="eyebrow text-gray-500 dark:text-gray-400">No classes after</label>
          <TimePicker
            size="sm"
            placeholder="Any time"
            :model-value="builder.filters.latestEnd"
            @update:model-value="builder.setFilters({ latestEnd: $event })"
          />
        </div>
      </div>

      <div class="space-y-1.5">
        <label class="eyebrow text-gray-500 dark:text-gray-400">Days off</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="d in DAYS"
            :key="d.code"
            type="button"
            class="px-2.5 py-1 rounded-xl text-[11px] font-semibold tracking-wide border transition-all duration-150 active:scale-[0.97]"
            :class="builder.filters.daysOff.includes(d.code)
              ? 'bg-primary-900 text-white border-primary-900 shadow-sm shadow-primary-900/15'
              : 'bg-surface dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100'"
            @click="toggleDayOff(d.code)"
          >
            {{ d.label }}
          </button>
        </div>
      </div>

      <Checkbox
        :model-value="builder.filters.openOnly"
        label="Open sections only"
        size="sm"
        @update:model-value="builder.setFilters({ openOnly: $event })"
      />
    </div>

    <!-- Generate -->
    <div class="space-y-2.5">
      <Button
        variant="primary"
        block
        :loading="builder.loading.sections"
        :disabled="!builder.candidates.length"
        @click="builder.generate()"
      >
        Generate schedules
      </Button>
      <p v-if="builder.fetchProgress" class="font-mono text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
        {{ builder.fetchProgress }}
      </p>

      <p v-if="builder.errors.sections" class="font-mono text-[12px] text-rust-600 dark:text-rust-500">
        {{ builder.errors.sections }}
      </p>

      <template v-if="builder.generated">
        <p
          v-for="slot in builder.emptySlots"
          :key="slot.key"
          class="font-mono text-[12px] text-rust-600 dark:text-rust-500"
        >
          {{ emptySlotMessage(slot) }}
        </p>
        <p v-if="showNoCombosMessage" class="font-mono text-[12px] text-rust-600 dark:text-rust-500">
          Every combination conflicts. Try relaxing filters.
        </p>
        <p
          v-for="label in builder.pinOverrides"
          :key="label"
          class="font-mono text-[11px] text-warning-700 dark:text-warning-400"
        >
          The pinned section for {{ label }} does not match your filters; it was kept anyway.
        </p>
      </template>
    </div>
  </div>
</template>
