<script setup>
import { computed, ref, watch } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

/**
 * 组件：ActionLibrary (技能库)
 * 作用：左侧侧边栏，显示当前选中干员的可用技能列表。
 * 功能：
 * 1. 技能拖拽源 (Drag Source)
 * 2. 修改基础数值 (Base Stats Editor Entry)
 * 3. 设置轨道初始充能和充能上限 (Gauge Settings)
 */
const store = useTimelineStore()

// 获取当前选中的轨道对象 (Track)
const activeTrack = computed(() => store.tracks.find(t => t.id === store.activeTrackId))

// 获取当前干员的基础信息 (Roster Data)
const activeCharacter = computed(() => {
  return store.characterRoster.find(c => c.id === store.activeTrackId)
})

const activeCharacterName = computed(() => activeCharacter.value ? activeCharacter.value.name : '干员')

/**
 * 计算属性：最大充能值 (双向绑定)
 * 读取逻辑：优先读取轨道上的“自定义上限” (maxGaugeOverride)，如果没有则读取角色默认值。
 * 写入逻辑：调用 store 方法更新当前轨道的 maxGaugeOverride。
 */
const maxGaugeValue = computed({
  get: () => {
    if (!activeTrack.value) return 100
    // 优先级：轨道自定义 > 角色配置 > 默认100
    return activeTrack.value.maxGaugeOverride || activeCharacter.value.ultimate_gaugeMax || 100
  },
  set: (val) => {
    if (store.activeTrackId) {
      store.updateTrackMaxGauge(store.activeTrackId, val)
    }
  }
})

/**
 * 计算属性：初始充能值 (双向绑定)
 * 控制时间轴 0 时刻的充能状态
 */
const initialGaugeValue = computed({
  get: () => activeTrack.value ? (activeTrack.value.initialGauge || 0) : 0,
  set: (val) => {
    if (store.activeTrackId) {
      store.updateTrackInitialGauge(store.activeTrackId, val)
    }
  }
})

const localSkills = ref([])

function onSkillClick(skillId) {
  store.selectLibrarySkill(skillId)
}

// 监听 store 中的技能库数据变化，并同步到本地 ref
// 这是为了防止直接修改 store 导致不可预知的副作用（虽然这里只是展示）
watch(
    () => store.activeSkillLibrary,
    (newVal) => {
      if (newVal && newVal.length > 0) {
        localSkills.value = JSON.parse(JSON.stringify(newVal))
      } else {
        localSkills.value = []
      }
    },
    { immediate: true, deep: true }
)

/**
 * 处理原生 HTML5 拖拽开始事件
 * 核心功能：创建一个自定义的“幽灵”元素 (Ghost Element) 作为拖拽时的视觉反馈。
 * * 为什么要手动创建 Ghost？
 * 默认的拖拽图像是半透明的元素本身。需要一个尺寸精确（反映技能持续时间长度）且样式清晰（蓝色虚线框）的视觉反馈。
 */
function onNativeDragStart(evt, skill) {
  // 1. 创建临时的 DOM 元素
  const rect = evt.target.getBoundingClientRect()
  const ghost = document.createElement('div');
  ghost.id = 'custom-drag-ghost';
  ghost.textContent = skill.name;

  // 计算该技能在时间轴上的实际宽度 (像素)
  const duration = Number(skill.duration) || 1;
  const realWidth = duration * store.timeBlockWidth;

  // 2. 设置 Ghost 样式 (模拟 TimelineGrid 中的 ActionItem)
  Object.assign(ghost.style, {
    position: 'absolute', top: '-9999px', left: '-9999px',
    width: `${realWidth}px`, height: '50px',
    backgroundColor: '#4a90e2', border: '2px dashed #ffffff',
    opacity: '1.0', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '0', boxSizing: 'border-box',
    fontSize: '14px', fontWeight: 'bold', zIndex: '999999', pointerEvents: 'none'
  });

  document.body.appendChild(ghost);

  // 3. 设置拖拽图像 (偏移量 x:10, y:25 保证鼠标位于左侧中心)
  evt.dataTransfer.setDragImage(ghost, 10, 25);
  evt.dataTransfer.effectAllowed = 'copy';

  // 4. 更新 Store 状态
  store.setDragOffset(0);
  store.setDraggingSkill(skill);
  store.setLibraryDragging(true); // 通知全局：拖拽开始了 (用于 CSS 穿透控制)

  document.body.classList.add('is-lib-dragging'); // 全局样式钩子

  // 5. 清理 DOM (setDragImage 只需要在这一帧存在即可)
  setTimeout(() => { const el = document.getElementById('custom-drag-ghost'); if (el) document.body.removeChild(el); }, 0);
}

function onNativeDragEnd() {
  store.setDraggingSkill(null)
  store.setLibraryDragging(false)
  document.body.classList.remove('is-lib-dragging')
}
</script>

<template>
  <div class="library-container">
    <div class="lib-header">
      <h3>{{ activeCharacterName }} 的技能</h3>
    </div>

    <div v-if="activeTrack && activeCharacter" class="gauge-settings-panel">

      <div class="setting-row-group">
        <div class="setting-label-row">
          <span class="label-text">初始充能 (Initial)</span>
          <span class="value-text">{{ initialGaugeValue }}</span>
        </div>
        <div class="setting-control-row">
          <el-slider
              v-model="initialGaugeValue"
              :max="maxGaugeValue"
              :show-tooltip="false"
              size="small"
              class="gauge-slider"
          />
          <el-input-number
              v-model="initialGaugeValue"
              :min="0"
              :max="maxGaugeValue"
              controls-position="right"
              size="small"
              class="gauge-input"
          />
        </div>
      </div>

      <hr class="separator"/>

      <div class="setting-row-group">
        <div class="setting-label-row">
          <span class="label-text">充能上限 (Max)</span>
          <span class="value-text" style="color: #ffd700;">{{ maxGaugeValue }}</span>
        </div>
        <div class="setting-control-row">
          <el-slider
              v-model="maxGaugeValue"
              :min="1"
              :max="200"
              :step="1"
              :show-tooltip="false"
              size="small"
              class="gauge-slider slider-orange"
          />
          <el-input-number
              v-model="maxGaugeValue"
              :min="1"
              controls-position="right"
              size="small"
              class="gauge-input input-orange"
          />
        </div>
      </div>

    </div>

    <div class="hint-text">点击技能可修改基础数值</div>

    <div class="skill-list">
      <div
          v-for="skill in localSkills"
          :key="skill.id"
          class="skill-item"
          :class="{ 'is-selected': store.selectedLibrarySkillId === skill.id }"
          :style="{ '--duration': skill.duration }"
          draggable="true"
          @dragstart="onNativeDragStart($event, skill)"
          @dragend="onNativeDragEnd"
          @click="onSkillClick(skill.id)"
      >
        {{ skill.name }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 基础布局 */
.library-container { padding: 15px; display: flex; flex-direction: column; flex-grow: 1; gap: 15px; }
.lib-header h3 { margin: 0; color: #f0f0f0; font-size: 16px; }

/* 充能设置面板样式 */
.gauge-settings-panel {
  background-color: #3a3a3a;
  border: 1px solid #555;
  border-radius: 6px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.setting-row-group { display: flex; flex-direction: column; gap: 4px; }
.setting-label-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #ccc;
}
.value-text { color: #00e5ff; font-family: monospace; }
.setting-control-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.gauge-slider { flex-grow: 1; margin-right: 5px; }
.gauge-input { width: 150px; }
.separator { border: 0; border-top: 1px dashed #555; margin: 8px 0; }

/* Element Plus 组件样式深度覆盖 (:deep)
  目的：强制将 Element Plus 的亮色系组件修改为暗色系风格
*/
:deep(.el-slider__runway) { background-color: #555; }
:deep(.el-slider__bar) { background-color: #00e5ff; }
:deep(.el-slider__button) { border-color: #00e5ff; background-color: #222; width: 14px; height: 14px; }
:deep(.el-input__wrapper) { background-color: #222; box-shadow: 0 0 0 1px #555 inset; }
:deep(.el-input__inner) { color: #f0f0f0; }
:deep(.el-input-number__decrease), :deep(.el-input-number__increase) { background-color: #333; border-color: #555; color: #aaa; }

/* 上限设置滑块的特殊颜色 (橙色/金色) */
.slider-orange { --el-slider-main-bg-color: #ffd700; }
:deep(.slider-orange .el-slider__bar) { background-color: #ffd700; }
:deep(.slider-orange .el-slider__button) { border-color: #ffd700; }

/* 技能列表样式 */
.skill-list { display: flex; flex-direction: row; flex-wrap: wrap; gap: 10px; }
.hint-text { font-size: 12px; color: #666; margin-top: -5px; margin-bottom: 5px; }
.skill-item {
  height: 50px; padding: 0 20px;
  display: flex; align-items: center; justify-content: center;
  background-color: #4f4f4f; border: 1px solid #666;
  box-sizing: border-box; border-radius: 4px;
  cursor: grab; font-weight: bold; color: white;
  user-select: none; transition: all 0.2s;
  width: 100px;
  flex-grow: 1;
}
.skill-item:active { cursor: grabbing; }
.skill-item:hover { background-color: #5a5a5a; border-color: #999; }
.skill-item.is-selected { border-color: #ffd700; color: #ffd700; background-color: #4a4a3a; box-shadow: 0 0 5px rgba(255, 215, 0, 0.3); }
</style>