<script setup>
import { computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import { storeToRefs } from 'pinia'

const props = defineProps({
  action: { type: Object, required: true }
})

const store = useTimelineStore()
const { iconDatabase } = storeToRefs(store)
const isSelected = computed(() => store.isActionSelected(props.action.instanceId))

// ===================================================================================
// 1. 基础样式与颜色计算 (Basic Styling)
// ===================================================================================

// 1.1 计算动作块主题色
const themeColor = computed(() => {
  // 优先级：自定义 > 特殊类型 > 自身属性 > 干员属性 > 默认
  if (props.action.customColor) return props.action.customColor
  if (props.action.type === 'link') return store.getColor('link')
  if (props.action.type === 'execution') return store.getColor('execution')
  if (props.action.type === 'attack') return store.getColor('physical')
  if (props.action.element) return store.getColor(props.action.element)

  let charId = null
  for (const track of store.tracks) {
    if (track.actions.some(a => a.instanceId === props.action.instanceId)) {
      charId = track.id
      break
    }
  }
  if (charId) return store.getCharacterElementColor(charId)
  return store.getColor('default')
})

// 1.2 主容器样式 (位置、尺寸、玻璃拟态)
const style = computed(() => {
  const widthUnit = store.timeBlockWidth
  const left = (props.action.startTime || 0) * widthUnit
  const width = (props.action.duration || 1) * widthUnit
  const finalWidth = width < 2 ? 2 : width
  const color = themeColor.value

  return {
    position: 'absolute',
    top: '0',
    height: '100%',
    left: `${left}px`,
    width: `${finalWidth}px`,
    boxSizing: 'border-box',
    zIndex: isSelected.value ? 20 : 10,
    border: `2px dashed ${isSelected.value ? '#ffffff' : color}`,
    backgroundColor: hexToRgba(color, 0.15),
    backdropFilter: 'blur(4px)',
    color: isSelected.value ? '#ffffff' : color,
    boxShadow: isSelected.value ? `0 0 10px ${color}` : 'none'
  }
})

// 1.3 冷却条样式 (底部细线)
const cdStyle = computed(() => {
  const widthUnit = store.timeBlockWidth
  const cd = props.action.cooldown || 0
  const width = cd > 0 ? (cd + 1) * widthUnit : 0
  return {
    width: `${width}px`,
    bottom: '-8px',
    left: '-2px',
    opacity: 0.6
  }
})

// 1.4 触发窗口样式 (左侧线)
const triggerWindowStyle = computed(() => {
  const widthUnit = store.timeBlockWidth
  const windowSize = props.action.triggerWindow || 0
  const width = windowSize * widthUnit
  const color = themeColor.value

  if (width <= 0) return { display: 'none' }

  return {
    '--tw-width': `${width}px`,
    '--tw-color': color,
    right: 'calc(100% + 2px)' // 修正父元素边框偏移，紧贴左侧
  }
})

// 1.5 辅助工具函数
function getEffectColor(type) {
  return store.getColor(type)
}

function getIconPath(type) {
  let charId = null
  for (const track of store.tracks) {
    if (track.actions.some(a => a.instanceId === props.action.instanceId)) {
      charId = track.id;
      break;
    }
  }
  if (charId) {
    const charInfo = store.characterRoster.find(c => c.id === charId)
    if (charInfo?.exclusive_buffs) {
      const exclusive = charInfo.exclusive_buffs.find(b => b.key === type)
      if (exclusive?.path) return exclusive.path
    }
  }
  return store.iconDatabase[type] || store.iconDatabase['default'] || ''
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(255,255,255,${alpha})`
  let c = hex.substring(1).split('');
  if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  c = '0x' + c.join('');
  return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + alpha + ')'
}

// ===================================================================================
// 2. 核心渲染逻辑：二维布局计算 (2D Layout Calculation)
// ===================================================================================

const renderableAnomalies = computed(() => {
  const raw = props.action.physicalAnomaly || []
  if (raw.length === 0) return []

  // 1. 数据标准化：确保是二维数组
  const rows = Array.isArray(raw[0]) ? raw : [raw]

  const widthUnit = store.timeBlockWidth
  const ICON_SIZE = 20
  const GAP = 2

  const resultRows = []

  // 2. 遍历计算布局
  rows.forEach((row, rowIndex) => {
    let currentLeft = 0 // 当前行的累积 X 偏移量

    const processedRow = row.map((effect, colIndex) => {
      const durationWidth = effect.duration > 0 ? (effect.duration * widthUnit) : 0

      // 定义 CSS 中设置的 margin-left 大小
      const BAR_MARGIN = 2

      // 1. 基础宽度
      let finalBarWidth = durationWidth

      // 2. 逻辑修正：如果不是首个元素，减去图标宽
      if (colIndex > 0 && finalBarWidth > 0) {
        finalBarWidth = Math.max(0, finalBarWidth - ICON_SIZE)
      }

      // 3. 减去左侧间距 (margin-left)，防止右侧溢出
      if (finalBarWidth > 0) {
        finalBarWidth = Math.max(0, finalBarWidth - BAR_MARGIN)
      }

      const itemLayout = {
        data: effect,
        rowIndex,
        colIndex,
        style: {
          left: `${currentLeft}px`,
          bottom: `${100 + (rowIndex * 50)}%`,
          position: 'absolute',
          zIndex: 15 + rowIndex
        },
        barWidth: finalBarWidth
      }

      // 4. 更新下一个元素的起始位置
      // 逻辑：当前位置 + 图标 + (间距+条子宽) + 元素间 GAP
      const occupiedWidth = finalBarWidth > 0 ? (BAR_MARGIN + finalBarWidth) : 0
      currentLeft += ICON_SIZE + occupiedWidth + GAP

      return itemLayout
    })
    resultRows.push(processedRow)
  })

  // 3. 展平数组以便 v-for 渲染
  return resultRows.flat()
})

// ===================================================================================
// 3. 交互事件 (Interaction)
// ===================================================================================

function onDeleteClick() {
  store.removeAction(props.action.instanceId)
}

function onIconClick(evt, index) {
  evt.stopPropagation()
  if (store.isLinking) {
    store.confirmLinking(props.action.instanceId, index)
  } else {
    store.selectAction(props.action.instanceId)
  }
}
</script>

<template>
  <div :id="`action-${action.instanceId}`" class="action-item-wrapper" :style="style" @click.stop @dragstart.prevent>

    <div class="action-item-content drag-handle">{{ action.name }}</div>

    <div v-if="isSelected" class="delete-btn-modern" @click.stop="onDeleteClick" title="删除 (Delete)">
      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </div>

    <div v-if="action.cooldown > 0" class="cd-bar-container" :style="cdStyle">
      <div class="cd-line" :style="{ backgroundColor: themeColor }"></div>
      <span class="cd-text" :style="{ color: themeColor }">{{ action.cooldown }}s</span>
      <div class="cd-end-mark" :style="{ backgroundColor: themeColor }"></div>
    </div>

    <div v-if="action.triggerWindow > 0" class="trigger-window-bar" :style="triggerWindowStyle">
      <div class="tw-dot"></div>
      <div class="tw-separator"></div>
    </div>

    <div class="anomalies-overlay">
      <div v-for="(item, index) in renderableAnomalies" :key="`${item.rowIndex}-${item.colIndex}`"
           class="anomaly-wrapper"
           :style="item.style">

        <div :id="`anomaly-${action.instanceId}-${index}`"
             class="anomaly-icon-box"
             @mousedown.stop="onIconClick($event, index)"
             @click.stop>
          <img :src="getIconPath(item.data.type)" class="anomaly-icon"/>
          <div v-if="item.data.stacks > 1" class="anomaly-stacks">{{ item.data.stacks }}</div>
        </div>
        <div class="anomaly-duration-bar" v-if="item.data.duration > 0"
             :style="{
               width: `${item.barWidth}px`,
               backgroundColor: getEffectColor(item.data.type)
             }">
          <div class="striped-bg"></div>
          <span class="duration-text">{{ item.data.duration }}s</span>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
/* === 基础容器 === */
.action-item-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  cursor: grab;
  user-select: none;
  position: relative;
  overflow: visible;
  transition: background-color 0.2s, box-shadow 0.2s, filter 0.2s;
  font-weight: bold;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.action-item-wrapper:hover {
  filter: brightness(1.2);
  z-index: 50 !important;
}

/* === 异常状态层 (Anomalies) === */
.anomalies-overlay {
  position: absolute;
  top: 0;
  left: calc(100% - 20px);
  width: 0;
  height: 100%;
  pointer-events: none;
  overflow: visible;
}

.anomaly-wrapper {
  display: flex;
  align-items: center;
  height: 22px;
  pointer-events: none;
  white-space: nowrap;
}

/* 图标盒子 */
.anomaly-icon-box {
  width: 20px;
  height: 20px;
  background-color: #333;
  border: 1px solid #999;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 10;
  flex-shrink: 0;
  pointer-events: auto;
  cursor: pointer;
  transition: transform 0.1s, border-color 0.1s;
}

.anomaly-icon-box:hover {
  border-color: #ffd700;
  transform: scale(1.2);
  z-index: 20;
}

.anomaly-icon {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.anomaly-stacks {
  position: absolute;
  bottom: -2px;
  right: -2px;
  background: rgba(0, 0, 0, 0.8);
  color: #ffd700;
  font-size: 8px;
  padding: 0 2px;
  line-height: 1;
  border-radius: 2px;
}

/* 持续时间条 */
.anomaly-duration-bar {
  height: 16px;
  border: none;
  border-radius: 2px;
  position: relative;
  display: flex;
  align-items: center;
  overflow: hidden;
  box-sizing: border-box;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  z-index: 1;
  margin-left: 2px;
}

.striped-bg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  background: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.2) 2px, transparent 2px, transparent 6px);
}

.duration-text {
  position: absolute;
  left: 4px;
  font-size: 11px;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  z-index: 2;
  font-weight: bold;
  line-height: 1;
  font-family: sans-serif;
}

/* === 冷却条 (CD Bar) === */
.cd-bar-container {
  position: absolute;
  height: 4px;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.cd-line {
  flex-grow: 1;
  height: 2px;
  margin-top: 1px;
  opacity: 0.6;
}

.cd-text {
  position: absolute;
  left: 0;
  top: 4px;
  font-size: 10px;
  font-weight: bold;
  line-height: 1;
}

.cd-end-mark {
  position: absolute;
  right: 0;
  top: -2px;
  width: 1px;
  height: 8px;
}

/* === 触发窗口 (Trigger Window) === */
.trigger-window-bar {
  position: absolute;
  /* 默认值消除 IDE 警告 */
  --tw-width: 0px;
  --tw-color: transparent;

  width: var(--tw-width);
  height: 4px;
  bottom: -8px;
  right: 100%;
  display: flex;
  align-items: center;
  pointer-events: none;
  z-index: 5;
  transform: translateY(-0.5px);
}

/* 亮线本体 */
.trigger-window-bar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background-color: var(--tw-color);
  opacity: 1;
  border-radius: 2px 0 0 2px;
}

/* 右侧分割线 */
.tw-separator {
  position: absolute;
  right: 0;
  top: -2px;
  width: 1px;
  height: 8px;
  background-color: var(--tw-color);
  box-shadow: 0 0 4px var(--tw-color);
  z-index: 6;
}

/* 左侧小球 */
.tw-dot {
  position: absolute;
  left: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background-color: var(--tw-color);
  z-index: 6;
}

/* === 删除按钮 === */
.delete-btn-modern {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 18px;
  height: 18px;
  background-color: #333;
  border: 1px solid #666;
  color: #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 30;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
  transition: all 0.2s ease;
}

.delete-btn-modern:hover {
  background-color: #d32f2f;
  border-color: #d32f2f;
  color: white;
  transform: scale(1.1);
}
</style>