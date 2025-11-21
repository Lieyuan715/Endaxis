<script setup>
import { computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

/**
 * 组件：GaugeOverlay (充能曲线图层)
 * 作用：叠加在轨道 (Track) 背景上，可视化显示该干员的大招充能变化趋势。
 * 层级：位于 ActionItem 下方 (z-index: 1)，不拦截鼠标事件。
 */
const props = defineProps({
  trackId: { type: String, required: false }
})

const store = useTimelineStore()

// === 布局常量 (SVG Coordinate System) ===
// 定义图表在轨道内的绘制区域
const ROW_HEIGHT = 50      // 轨道总高度
const CHART_HEIGHT = 46    // 图表最大绘制高度 (留出一点 padding)
const BASE_Y = ROW_HEIGHT - 2 // Y轴零点 (底部)，预留 2px 底部边距
const TOP_Y = BASE_Y - CHART_HEIGHT // Y轴峰值 (顶部)

/**
 * 获取计算后的充能数据点
 * 数据格式: [{ time: 0, val: 50, ratio: 0.5 }, ...]
 */
const gaugePoints = computed(() => {
  if (!props.trackId) return []
  return store.calculateGaugeData(props.trackId)
})

/**
 * 1. 基础路径 (Polyline Path)
 * 将时间序列数据转换为 SVG <polyline> 的 points 字符串
 * 转换公式：
 * X = 时间 * 单位宽度
 * Y = 基准底线 - (充能比例 * 图表高度)
 */
const pathData = computed(() => {
  if (gaugePoints.value.length === 0) return ''
  return gaugePoints.value.map(p => {
    const x = p.time * store.timeBlockWidth
    const y = BASE_Y - (p.ratio * CHART_HEIGHT)
    return `${x},${y}`
  }).join(' ')
})

/**
 * 2. 满充能高亮片段 (Full Gauge Segments)
 * 逻辑：遍历所有数据点，找出连续的“满充能”区间 (ratio >= 0.999)。
 * 作用：单独绘制一条带有发光动画的水平线，提示玩家此时大招已就绪。
 */
const fullSegments = computed(() => {
  const segments = []
  const points = gaugePoints.value
  // 获取当前缩放下的单位宽度
  const currentBlockWidth = store.timeBlockWidth

  for (let i = 0; i < points.length - 1; i++) {
    // 如果当前点和下一点都是满充能，则这是一段满充能区间
    if (points[i].ratio >= 0.999 && points[i + 1].ratio >= 0.999) {
      const x1 = points[i].time * currentBlockWidth
      const x2 = points[i + 1].time * currentBlockWidth
      if (x2 > x1) {
        segments.push({x1, x2})
      }
    }
  }
  return segments
})
</script>

<template>
  <div class="gauge-overlay">
    <svg class="gauge-svg" height="50" :width="store.TOTAL_DURATION * store.timeBlockWidth">

      <polyline
          :points="pathData"
          fill="none"
          stroke="#00e5ff"
          stroke-opacity="0.3"
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
          class="no-events"
      />

      <line
          v-for="(seg, i) in fullSegments"
          :key="i"
          :x1="seg.x1" :y1="TOP_Y"
          :x2="seg.x2" :y2="TOP_Y"
          class="full-gauge-line no-events"
      />
    </svg>
  </div>
</template>

<style scoped>
.gauge-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* [CRITICAL] 必须设为 none，否则会遮挡下方轨道的 drop 事件和内部 ActionItem 的点击事件 */
  pointer-events: none;
  z-index: 1;
  overflow: visible;
}

/* 强制 SVG 元素穿透，双重保险 */
.no-events {
  pointer-events: none !important;
}

.full-gauge-line {
  stroke: #00e5ff;
  stroke-width: 3;
  stroke-linecap: round;
  /* 发光滤镜 */
  filter: drop-shadow(0 0 4px #00e5ff);
  /* 呼吸灯动画 */
  animation: pulse-glow 1.5s infinite alternate;
}

@keyframes pulse-glow {
  0% {
    stroke-opacity: 0.6;
    filter: drop-shadow(0 0 2px #00e5ff);
  }
  100% {
    stroke-opacity: 1;
    filter: drop-shadow(0 0 6px #00e5ff);
  }
}
</style>