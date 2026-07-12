<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{
  id: string
  label: string
  modelValue: string
  autocomplete?: string | undefined
  error?: string | undefined
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const visible = ref(false)
const actionLabel = computed(
  () => `${visible.value ? 'Hide' : 'Show'} ${props.label.toLowerCase()}`,
)
</script>

<template>
  <div class="field">
    <label :for="id">{{ label }}</label>
    <div class="secret-control">
      <input
        :id="id"
        :value="modelValue"
        :type="visible ? 'text' : 'password'"
        :autocomplete="autocomplete ?? 'off'"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? `${id}-error` : undefined"
        @input="
          emit('update:modelValue', ($event.target as HTMLInputElement).value)
        "
      />
      <button
        type="button"
        class="icon-button"
        :aria-label="actionLabel"
        :title="actionLabel"
        @click="visible = !visible"
      >
        <EyeOff v-if="visible" :size="18" aria-hidden="true" />
        <Eye v-else :size="18" aria-hidden="true" />
      </button>
    </div>
    <p v-if="error" :id="`${id}-error`" class="field-error">{{ error }}</p>
  </div>
</template>
