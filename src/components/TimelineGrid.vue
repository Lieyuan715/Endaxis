<script setup>
import { useTimelineStore } from '../stores/timelineStore.js'
import { ref, provide, onMounted, onUnmounted, nextTick, computed ,watch } from 'vue'
import ActionItem from './ActionItem.vue'
import ActionConnector from './ActionConnector.vue'
import GaugeOverlay from './GaugeOverlay.vue'

/**
 * 组件：TimelineGrid (核心时间轴网格)
 * 作用：应用的中心工作区，负责轨道的渲染、动作块的放置与拖拽交互、SVG连线绘制。
 * 核心机制：
 * 1. 双坐标系统：使用 Grid (CSS) 布局，同时通过 JavaScript 计算鼠标坐标映射为时间 (Time)。
 * 2. SVG 覆盖层：在 DOM 节点之上悬浮一个 SVG 层绘制连线，需要处理滚动同步。
 * 3. 复杂拖拽机：手写了一套基于 MouseEvent 的拖拽逻辑，支持吸附、防抖和状态管理。
 */
const store = useTimelineStore()
const TIME_BLOCK_WIDTH = computed(() => store.timeBlockWidth)
provide('TIME_BLOCK_WIDTH', TIME_BLOCK_WIDTH)

// 时间轴标尺
const timeBlocks = computed(() => {
  return Array.from({ length: store.TOTAL_DURATION }, (_, i) => i + 1)
})

// SVG 重绘触发器 (Key-changing pattern)
const svgRenderKey = ref(0)

// DOM 引用
const tracksContentRef = ref(null)
const timeRulerWrapperRef = ref(null)
const tracksHeaderRef = ref(null)
let resizeObserver = null

// === 内部拖拽状态机 (Drag State Machine) ===
const isMouseDown = ref(false)
const isDragStarted = ref(false)
const movingActionId = ref(null)
const movingTrackId = ref(null)
const initialMouseX = ref(0)
const initialMouseY = ref(0)
const dragThreshold = 5 // 拖拽防抖阈值 (像素)

// 记录按下鼠标时的选中状态，用于区分 Click 和 Drag 的选中逻辑
const wasSelectedOnPress = ref(false)

// 将干员按稀有度分组 (用于下拉框)
const groupedCharacters = computed(() => {
  const groups = {}
  store.characterRoster.forEach(char => {
    const rarity = char.rarity || 0
    if (!groups[rarity]) groups[rarity] = []
    groups[rarity].push(char)
  })
  return Object.keys(groups).sort((a, b) => b - a).map(rarity => ({
    label: rarity > 0 ? `${rarity} ★` : '未知星级',
    options: groups[rarity]
  }))
})

/**
 * 强制重绘 SVG 连线
 * 当发生滚动、缩放、拖拽结束时调用，更新 render-key 触发 ActionConnector 重新计算坐标
 */
function forceSvgUpdate() { svgRenderKey.value++ }

/**
 * 同步水平滚动 (Sync Horizontal Scroll)
 * 让时间标尺 (Ruler) 跟随内容区 (Content) 左右滚动
 */
function syncRulerScroll() {
  if (timeRulerWrapperRef.value && tracksContentRef.value) {
    const left = tracksContentRef.value.scrollLeft
    timeRulerWrapperRef.value.scrollLeft = left
    store.setScrollLeft(left) // 同步到 Store 供 SP Monitor 使用
  }
  forceSvgUpdate()
}

/**
 * 同步垂直滚动 (Sync Vertical Scroll)
 * 让左侧头像栏 (Header) 跟随内容区 (Content) 上下滚动
 */
function syncVerticalScroll() {
  if (tracksHeaderRef.value && tracksContentRef.value) {
    tracksHeaderRef.value.scrollTop = tracksContentRef.value.scrollTop
  }
}

/**
 * 核心算法：鼠标坐标 -> 时间戳
 * @param {MouseEvent} evt
 * @returns {number} 时间 (秒)，精确到 0.5s
 */
function calculateTimeFromEvent(evt) {
  const trackRect = tracksContentRef.value.getBoundingClientRect()
  const scrollLeft = tracksContentRef.value.scrollLeft
  const mouseX = evt.clientX

  // 减去左侧面板宽度偏移 (如果是从外部拖入，store 会记录这个偏移，但这里简化处理)
  // 注意：evt.clientX 是视口坐标。需要计算相对于 track-content 起始点的 x。
  // 公式：相对X = (鼠标X - 轨道左边缘X) + 滚动条卷去距离X

  // 这里 store.globalDragOffset 主要用于 ActionLibrary 拖拽时的修正，
  // 内部拖拽通常不需要它，或者需要单独处理。这里简化为直接计算。
  const activeOffset = store.globalDragOffset || 0 // 兼容库拖拽

  const mouseXInTrack = (mouseX - activeOffset) - trackRect.left + scrollLeft

  // 像素 -> 时间块索引
  const fractionalBlockIndex = mouseXInTrack / TIME_BLOCK_WIDTH.value

  // 量化对齐 (Snap to Grid): 0.5s 步长
  let startTime = Math.round(fractionalBlockIndex * 2) / 2
  if (startTime < 0) startTime = 0
  return startTime
}

// 监听缩放变化，重绘连线
watch(
    () => store.timeBlockWidth,
    () => { nextTick(() => forceSvgUpdate()) }
)

// === 外部拖拽 (Drop Zone) ===
function onTrackDragOver(evt) {
  evt.preventDefault()
  evt.dataTransfer.dropEffect = 'copy'
}

function onTrackDrop(track, evt) {
  const skill = store.draggingSkillData
  if (!skill) return
  // 只有当前激活的轨道允许放入 (可选限制)
  if (store.activeTrackId !== track.id) return

  const startTime = calculateTimeFromEvent(evt)
  store.addSkillToTrack(track.id, skill, startTime)
  nextTick(() => forceSvgUpdate())
}

// === 动作块点击处理 ===
function onActionClick(action) {
  // 1. 如果刚刚发生了拖拽位移，这不算一次“点击”，忽略之
  if (isDragStarted.value) return

  // 2. [核心修复] 取消选中的逻辑
  // 只有当 "按下鼠标那一刻它就是选中状态" (wasSelectedOnPress.value === true)
  // 并且当前依然是选中状态时，才执行取消选中。
  // 原因：如果是未选中状态，mousedown 已经把它设为 active 了。如果不加判断，
  // 紧接着的 click 事件会再次触发 toggle，导致刚选中又马上取消。
  if (wasSelectedOnPress.value && store.selectedActionId === action.instanceId) {
    store.selectAction(action.instanceId) // selectAction 内部实现了 toggle 逻辑 (id === current ? null : id)
  }
}

// === 内部拖拽交互 (核心) ===
function onActionMouseDown(evt, track, action) {
  // [关键修复] 不要使用 evt.preventDefault()，否则无法触发 input focus 和 select 下拉
  evt.stopPropagation() // 防止冒泡触发背景点击

  if (evt.button !== 0) return // 只响应左键

  // 记录按下时的选中状态
  wasSelectedOnPress.value = (store.selectedActionId === action.instanceId)

  // 如果当前未选中，且不是在连线模式，立即选中它提供视觉反馈
  if (!store.isLinking && !wasSelectedOnPress.value) {
    store.selectAction(action.instanceId)
  }

  // 初始化拖拽状态
  isMouseDown.value = true
  isDragStarted.value = false
  movingActionId.value = action.instanceId
  movingTrackId.value = track.id
  initialMouseX.value = evt.clientX
  initialMouseY.value = evt.clientY

  // 设置全局偏移 (可选，用于视觉修正)
  const rect = evt.currentTarget.getBoundingClientRect()
  store.setDragOffset(evt.clientX - rect.left)

  // 绑定全局监听
  window.addEventListener('mousemove', onWindowMouseMove)
  window.addEventListener('mouseup', onWindowMouseUp)
  // [健壮性] 监听切屏/失焦，防止鼠标状态残留
  window.addEventListener('blur', onWindowMouseUp)
}

function onWindowMouseMove(evt) {
  if (!isMouseDown.value) return

  // [安全阀 1] 如果左键没按着 (buttons=0)，强制结束
  // 场景：鼠标拖出窗口释放后回来，或者系统弹窗打断
  if (evt.buttons === 0) {
    onWindowMouseUp(evt)
    return
  }

  // [安全阀 2] 区域隔离 (Zone Exclusion)
  // 场景：用户可能快速移动鼠标点击了右侧属性面板的输入框。
  // 此时 target 变成了 input，如果不拦截，动作块会瞬间跳变。
  const target = evt.target

  // 判定 A: 目标是表单元素
  const isFormElement = target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
  )

  // 判定 B: 目标位于侧边栏区域
  const isInSidebar = target && (
      target.closest('.properties-sidebar') ||
      target.closest('.action-library')
  )

  if (isFormElement || isInSidebar) {
    onWindowMouseUp(evt) // 立即中断拖拽
    return
  }

  // [防抖] 移动距离超过阈值才算开始拖拽
  if (!isDragStarted.value) {
    const dist = Math.sqrt(Math.pow(evt.clientX - initialMouseX.value, 2) + Math.pow(evt.clientY - initialMouseY.value, 2))
    if (dist > dragThreshold) {
      isDragStarted.value = true
    } else {
      return
    }
  }

  // [执行拖拽]
  const track = store.tracks.find(t => t.id === movingTrackId.value)
  const action = track?.actions.find(a => a.instanceId === movingActionId.value)

  if (action) {
    const newTime = calculateTimeFromEvent(evt)
    // 只有时间发生变化时才更新，减少重绘
    if (isDragStarted.value && newTime !== action.startTime) {
      action.startTime = newTime
      // 保持动作块有序
      track.actions.sort((a, b) => a.startTime - b.startTime)
      nextTick(() => forceSvgUpdate()) // 拖拽过程中实时更新连线
    }
  }
}

function onWindowMouseUp(evt) {
  // [防抖逻辑] 记录之前是否在拖拽，用于后续阻止 click 事件
  const _wasDragging = isDragStarted.value

  try {
    // 如果没有发生拖拽 (纯点击)
    if (!isDragStarted.value && movingActionId.value) {
      if (store.isLinking) {
        // 连线模式下：确认连接
        store.confirmLinking(movingActionId.value)
      } else {
        // 普通模式下：取消连线状态
        // [修复] 修正方法名 cancelConnection -> cancelLinking
        if (store.cancelLinking) {
          store.cancelLinking()
        }
      }
    }
  } catch (error) {
    console.error("MouseUp Error:", error)
  } finally {

    isMouseDown.value = false
    isDragStarted.value = false
    movingActionId.value = null
    movingTrackId.value = null

    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
    window.removeEventListener('blur', onWindowMouseUp)
  }

  // 如果发生了拖拽，阻止后续的 click 事件冒泡
  if (_wasDragging) {
    window.addEventListener('click', captureClick, { capture: true, once: true })
  }
}

// 捕获并阻止冒泡的辅助函数
function captureClick(e) {
  e.stopPropagation()
  e.preventDefault()
}

// 背景点击：取消选择
function onBackgroundClick(event) {
  // 只有直接点击轨道背景或网格线时才触发
  if (event.target === tracksContentRef.value || event.target.classList.contains('track-row') || event.target.classList.contains('time-block')) {
    store.cancelLinking()
    store.selectTrack(null)
  }
}

// 键盘快捷键
function handleKeyDown(event) {
  if (!store.selectedActionId) return
  if (event.key === 'Delete') {
    store.removeAction(store.selectedActionId)
    event.preventDefault()
  }
}

// 深度监听数据变化，确保视图同步
watch(
    () => [store.tracks, store.connections],
    () => {
      // 导入大文件时，DOM 渲染需要时间，使用 setTimeout 延后执行重绘
      setTimeout(() => {
        forceSvgUpdate()
      }, 50)
    },
    {deep: false}
)

onMounted(() => {
  if (tracksContentRef.value) {
    // 绑定滚动同步
    tracksContentRef.value.addEventListener('scroll', syncRulerScroll)
    tracksContentRef.value.addEventListener('scroll', syncVerticalScroll)

    // 监听容器大小变化 (ResizeObserver)
    resizeObserver = new ResizeObserver(() => {
      forceSvgUpdate()
    })
    resizeObserver.observe(tracksContentRef.value)
  }
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  if (tracksContentRef.value) {
    tracksContentRef.value.removeEventListener('scroll', syncRulerScroll)
    tracksContentRef.value.removeEventListener('scroll', syncVerticalScroll)
    if (resizeObserver) resizeObserver.disconnect()
  }
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('mousemove', onWindowMouseMove)
  window.removeEventListener('mouseup', onWindowMouseUp)
})
</script>

<template>
  <div class="timeline-grid-layout">
    <div class="corner-placeholder"></div>

    <div class="time-ruler-wrapper" ref="timeRulerWrapperRef" @click="store.selectTrack(null)">
      <div class="time-ruler-track">
        <div v-for="block in timeBlocks" :key="block" class="ruler-tick" :style="{ width: `${TIME_BLOCK_WIDTH}px` }"
             :class="{ 'major-tick': (block === 1 || block % 5 === 0) }">
          <span v-if="block === 1 || block % 5 === 0" class="tick-label">{{ block }}s</span>
        </div>
      </div>
    </div>

    <div class="tracks-header-sticky" ref="tracksHeaderRef" @click="store.selectTrack(null)">
      <div v-for="(track, index) in store.teamTracksInfo" :key="index" class="track-info"
           @click.stop="store.selectTrack(track.id)"
           :class="{ 'is-active': track.id && track.id === store.activeTrackId }">
        <img v-if="track.id" :src="track.avatar" class="avatar-image" :alt="track.name"/>
        <div v-else class="avatar-placeholder"></div>

        <el-select :model-value="track.id" @change="(newId) => store.changeTrackOperator(index, track.id, newId)"
                   placeholder="选择干员" class="character-select" @click.stop>
          <el-option-group v-for="group in groupedCharacters" :key="group.label" :label="group.label">
            <el-option v-for="character in group.options" :key="character.id" :label="character.name"
                       :value="character.id"/>
          </el-option-group>
        </el-select>
      </div>
    </div>

    <div class="tracks-content-scroller" ref="tracksContentRef" @click="onBackgroundClick">
      <div class="tracks-content">

        <svg class="connections-svg">
          <template v-if="tracksContentRef">
            <ActionConnector v-for="conn in store.connections" :key="conn.id" :connection="conn"
                             :container-ref="tracksContentRef" :render-key="svgRenderKey"/>
          </template>
        </svg>

        <div v-for="(track, index) in store.tracks" :key="index" class="track-row"
             :class="{ 'is-active-drop': track.id === store.activeTrackId }"
             @dragover="onTrackDragOver"
             @drop="onTrackDrop(track, $event)">

          <div v-for="block in timeBlocks" :key="block" class="time-block"></div>

          <GaugeOverlay v-if="track.id" :track-id="track.id"/>

          <div class="actions-container">
            <ActionItem v-for="action in track.actions"
                        :key="action.instanceId"
                        :action="action"
                        @mousedown="onActionMouseDown($event, track, action)"
                        @click.stop="onActionClick(action)"
                        :class="{ 'is-moving': isDragStarted && movingActionId === action.instanceId }"/>
          </div>
        </div>

      </div>
    </div>
  </div>
</template>

<script>
// 注册局部组件
import GaugeOverlay from './GaugeOverlay.vue'

export default {components: {GaugeOverlay}}
</script>

<style scoped>
/* === 核心 Grid 布局 === */
.timeline-grid-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  grid-template-rows: 40px 1fr;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

/* 区域 1: 左上角占位 */
.corner-placeholder {
  grid-column: 1 / 2;
  grid-row: 1 / 2;
  background-color: #3a3a3a;
  border-bottom: 1px solid #444;
  border-right: 1px solid #444;
}

/* 区域 2: 顶部时间标尺 */
.time-ruler-wrapper {
  grid-column: 2 / 3;
  grid-row: 1 / 2;
  background-color: #3a3a3a;
  border-bottom: 1px solid #444;
  overflow: hidden;
  z-index: 6;
}

.time-ruler-track {
  display: flex;
  flex-direction: row;
  width: fit-content;
  height: 100%;
}

.ruler-tick {
  height: 100%;
  border-right: 1px solid #4a4a4a;
  box-sizing: border-box;
  flex-shrink: 0;
  position: relative;
  color: #aaa;
}

.ruler-tick::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 1px;
  height: 5px;
  background-color: #666;
}

.ruler-tick.major-tick::after {
  height: 10px;
  background-color: #aaa;
}

.tick-label {
  position: absolute;
  left: 4px;
  top: 4px;
  font-size: 12px;
  color: #f0f0f0;
  font-weight: bold;
}

/* 区域 3: 左侧头像栏 */
.tracks-header-sticky {
  grid-column: 1 / 2;
  grid-row: 2 / 3;
  width: 180px;
  background-color: #3a3a3a;
  display: flex;
  flex-direction: column;
  z-index: 6;
  border-right: 1px solid #444;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 20px 0;
  height: 100%;
  justify-content: space-evenly;
  overflow-x: scroll;
}

/* 区域 4: 右下主内容 (滚动容器) */
.tracks-content-scroller {
  grid-column: 2 / 3;
  grid-row: 2 / 3;
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;
}

.tracks-content {
  position: relative;
  width: fit-content;
  min-width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 20px 0;
  justify-content: space-evenly;
  min-height: 100%;
}

/* 轨道头 (Header Item) 样式 */
.track-info {
  height: 50px;
  display: flex;
  align-items: center;
  background-color: #3a3a3a;
  flex-shrink: 0;
  cursor: pointer;
  transition: background-color 0.2s;
  box-sizing: border-box;
  padding-left: 8px;
}

.track-info.is-active {
  background-color: #4a5a6a;
  border-right: 3px solid #ffd700;
}

.avatar-image {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background-color: #555;
  margin-right: 8px;
  flex-shrink: 0;
  object-fit: cover;
}

.avatar-placeholder {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background-color: #444;
  border: 2px dashed #666;
  margin-right: 8px;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* Element Plus Select 样式穿透 (变透明) */
.character-select {
  flex-grow: 1;
  width: 0;
}

.character-select :deep(.el-input__wrapper) {
  background-color: transparent !important;
  box-shadow: none !important;
  padding: 0;
}

.character-select :deep(.el-input__inner) {
  color: #f0f0f0;
  font-size: 16px;
  font-weight: bold;
}

.character-select :deep(.el-input) {
  --el-input-border-color: transparent;
  --el-input-hover-border-color: transparent;
  --el-input-focus-border-color: transparent;
}

.character-select :deep(.el-select__caret) {
  display: none;
}

.track-info:hover .character-select :deep(.el-select__caret) {
  display: inline-block;
}

/* 轨道行 (Track Row) 样式 */
.track-row {
  position: relative;
  height: 50px;
  display: flex;
  flex-direction: row;
  background-color: #333;
  transition: background-color 0.2s, filter 0.3s, opacity 0.3s;
  overflow: visible;
  border-top: 2px solid transparent;
  border-bottom: 2px solid transparent;
  box-sizing: border-box;
}

.track-row.is-active-drop {
  border-top: 2px dashed #c0c0c0;
  border-bottom: 2px dashed #c0c0c0;
  z-index: 20;
}

/* 网格背景 */
.time-block {
  width: 50px;
  height: 100%;
  border-right: 1px solid #4a4a4a;
  box-sizing: border-box;
  flex-shrink: 0;
}

/* 层级管理 */
.actions-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  min-width: 100%;
  z-index: 10;
  pointer-events: auto;
  display: block;
}

.connections-svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 25;
  pointer-events: none;
  overflow: visible;
}
</style>