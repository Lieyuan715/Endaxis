<script setup>
import { computed, watch, ref } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

/**
 * 组件：SpMonitor (全局技力监控器)
 * 作用：位于 TimelineEditor 底部，展示全局共享技力 (SP) 随时间的变化曲线。
 * 核心功能：
 * 1. 可视化 SP 增长（自然回复 + 技能回复）
 * 2. 可视化 SP 消耗（释放战技）
 * 3. 警告功能：当 SP 跌破 0 时，标记为“不足”区域。
 * 4. [升级] 支持动态时长的网格绘制，与主时间轴完全对齐。
 */
const store = useTimelineStore()
const scrollContainer = ref(null)

// === 图表配置常量 ===
const MAX_SP = 300       // Y轴最大值 (对应游戏内 SP 上限)
const SVG_HEIGHT = 140   // SVG 画布总高度 (px)

// === 坐标系布局参数 ===
// 用途：将 SP 数值映射到 SVG 的 Y 轴坐标
const PADDING_TOP = 2     // 顶部留白 (px)，防止最高点(300)被截断
const PADDING_BOTTOM = 20 // 底部留白 (px)，用于绘制底部的 X 轴文字 (0, 5s, 10s...)
const BASE_Y = SVG_HEIGHT - PADDING_BOTTOM // 零点基准线 Y 坐标 (SP = 0 的位置)
const EFFECTIVE_HEIGHT = BASE_Y - PADDING_TOP // 有效绘图区域高度
const SCALE_Y = EFFECTIVE_HEIGHT / MAX_SP     // 比例尺：1 SP 对应多少像素高度

/**
 * 计算垂直网格线的数量
 * 逻辑：总时长 / 5秒间隔，向上取整。例如 120秒 -> 24条线。
 */
const gridLinesCount = computed(() => Math.ceil(store.TOTAL_DURATION / 5))

/**
 * 获取全局 SP 数据序列
 * 数据源：store.calculateGlobalSpData()
 * 格式：[{ time: 0, sp: 200, type: 'init' }, { time: 2.5, sp: 100, type: 'cost' }, ...]
 */
const spData = computed(() => {
  return store.calculateGlobalSpData()
})

/**
 * 生成折线图路径 (SVG Polyline Points)
 * 将数据点转换为 SVG 坐标字符串 "x1,y1 x2,y2 ..."
 * 公式：
 * X = 时间 * 单位宽度
 * Y = 基准线 - (SP值 * 比例尺)
 */
const polylinePoints = computed(() => {
  if (spData.value.length === 0) return ''
  return spData.value.map(p => {
    const x = p.time * store.timeBlockWidth
    let y = BASE_Y - (p.sp * SCALE_Y)
    return `${x},${y}`
  }).join(' ')
})

/**
 * 计算警告区域 (Warning Zones)
 * 筛选出 SP < 0 的数据点，用于在图表下方显示红色的 "⚠️不足" 提示标签。
 */
const warningZones = computed(() => {
  return spData.value.filter(p => p.sp < 0).map(p => ({
    left: p.time * store.timeBlockWidth,
    sp: p.sp
  }))
})

// 滚动同步：监听 store 的滚动位置，使图表与上方时间轴保持严格对齐
watch(
    () => store.timelineScrollLeft,
    (newVal) => {
      if (scrollContainer.value) {
        scrollContainer.value.scrollLeft = newVal
      }
    }
)
</script>

<template>
  <div class="sp-monitor-layout">

    <div class="monitor-sidebar">
      <div class="info-group">
        <div class="info-title">SP 趋势模拟</div>
        <div class="info-detail">初始: 200</div>
        <div class="info-detail">回复: 8/s</div>
      </div>
      <div class="legend-group">
        <div class="legend-item"><span class="dot sp-dot"></span>全队共享</div>
        <div class="legend-item"><span class="line-mark max-mark"></span>上限(300)</div>
      </div>
    </div>

    <div class="chart-scroll-wrapper" ref="scrollContainer">
      <svg class="sp-chart-svg" :height="SVG_HEIGHT" :width="store.TOTAL_DURATION * store.timeBlockWidth">

        <line v-for="i in gridLinesCount" :key="`grid-${i}`"
              :x1="i * 5 * store.timeBlockWidth" y1="0"
              :x2="i * 5 * store.timeBlockWidth" :y2="SVG_HEIGHT"
              stroke="#333" stroke-width="1" stroke-dasharray="2" />

        <line x1="0" :y1="PADDING_TOP" :x2="store.TOTAL_DURATION * store.timeBlockWidth" :y2="PADDING_TOP"
              stroke="#666" stroke-width="1" stroke-dasharray="4" />
        <text x="5" :y="PADDING_TOP + 10" fill="#888" font-size="10">MAX (300)</text>

        <line x1="0" :y1="BASE_Y - (200 * SCALE_Y)" :x2="store.TOTAL_DURATION * store.timeBlockWidth" :y2="BASE_Y - (200 * SCALE_Y)"
              stroke="#444" stroke-width="1" stroke-dasharray="2" />

        <line x1="0" :y1="BASE_Y - (100 * SCALE_Y)" :x2="store.TOTAL_DURATION * store.timeBlockWidth" :y2="BASE_Y - (100 * SCALE_Y)"
              stroke="#444" stroke-width="1" stroke-dasharray="2" />

        <line x1="0" :y1="BASE_Y" :x2="store.TOTAL_DURATION * store.timeBlockWidth" :y2="BASE_Y"
              stroke="#aaa" stroke-width="2" />
        <text x="5" :y="BASE_Y + 12" fill="#666" font-size="10">0</text>

        <rect x="0" :y="BASE_Y" :width="store.TOTAL_DURATION * store.timeBlockWidth" :height="SVG_HEIGHT - BASE_Y" fill="rgba(211, 47, 47, 0.15)" />

        <polyline
            :points="polylinePoints"
            fill="none"
            stroke="#ffd700"
            stroke-width="2"
            stroke-linejoin="round"
        />

        <circle
            v-for="(p, idx) in spData"
            :key="idx"
            :cx="p.time * store.timeBlockWidth"
            :cy="BASE_Y - (p.sp * SCALE_Y)"
            r="3"
            :fill="p.sp < 0 ? '#ff4d4f' : '#ffd700'"
            stroke="#000" stroke-width="1"
        />
      </svg>

      <div v-for="(w, idx) in warningZones" :key="idx" class="warning-tag" :style="{ left: w.left + 'px', top: (BASE_Y + 5) + 'px' }">
        ⚠️不足
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 整体布局：Grid 分栏 */
.sp-monitor-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  width: 100%;
  height: 100%;
  background: #222;
  border-top: 1px solid #444;
}

/* 左侧侧边栏样式 */
.monitor-sidebar {
  background-color: #333;
  border-right: 1px solid #444;
  padding: 15px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 10px;
  color: #ccc;
  font-size: 12px;
}
.info-title { font-weight: bold; color: #f0f0f0; margin-bottom: 5px; font-size: 13px; }
.info-detail { color: #999; }
.legend-group { margin-top: 5px; border-top: 1px solid #555; padding-top: 10px; }
.legend-item { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }

/* 图例图标 */
.dot { width: 8px; height: 8px; border-radius: 50%; }
.sp-dot { background: #ffd700; }
.line-mark { width: 12px; height: 2px; background: #666; }

/* 右侧图表容器 */
.chart-scroll-wrapper {
  position: relative;
  overflow: hidden; /* 隐藏原生滚动条，完全依赖 JS 同步 */
  background: #282828;
}
.sp-chart-svg { display: block; }

/* 警告标签样式 */
.warning-tag {
  position: absolute;
  font-size: 10px;
  color: #ff4d4f;
  background: rgba(0,0,0,0.8);
  padding: 2px 4px;
  border-radius: 4px;
  transform: translateX(-50%); /* 居中对齐关键点 */
  white-space: nowrap;
  pointer-events: none; /* 防止遮挡下方交互 */
  z-index: 5;
}
</style>