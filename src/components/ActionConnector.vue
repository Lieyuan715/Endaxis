<script setup>
import { computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

/**
 * 组件：ActionConnector
 * 作用：在 SVG 层绘制动作块之间的连线
 * 原理：通过 DOM API 获取实际元素位置，计算相对于滚动容器的绝对坐标
 */
const props = defineProps({
  /** 连接数据对象 {id, from, to, fromEffectIndex, ...} */
  connection: { type: Object, required: true },
  /** 滚动容器的 DOM 引用 (tracks-content-scroller)，用于计算相对坐标 */
  containerRef: { type: Object, required: true },
  /** 强制渲染 Key：当父组件检测到滚动或缩放时改变此值，触发 computed 重新计算 */
  renderKey: { type: Number }
})

const store = useTimelineStore()

const pathData = computed(() => {
  // [响应式触发器]
  // 由于 DOM 元素的位置 (getBoundingClientRect) 不是 Vue 响应式的，
  // 必须访问 props.renderKey 来建立依赖。当父组件更新 renderKey 时，此 computed 会重新执行。
  const _dependencyTrigger = props.renderKey;

  if (!props.containerRef) return ''

  // 1. 查找起始和终点元素
  // 默认从动作块 (Action Item) 发起
  const fromEl = document.getElementById(`action-${props.connection.from}`)
  const toEl = document.getElementById(`action-${props.connection.to}`)

  let actualFromEl = fromEl;

  // [逻辑分支] 如果是“异常状态 (Anomaly)”发起的连线，尝试查找具体的图标元素
  // 这样连线会从具体的 Buff 图标位置发出，而不是整个动作块中心
  if (props.connection.fromEffectIndex !== undefined && props.connection.fromEffectIndex !== null) {
    const iconEl = document.getElementById(`anomaly-${props.connection.from}-${props.connection.fromEffectIndex}`);
    if (iconEl) {
      actualFromEl = iconEl;
    }
  }

  // 如果找不到 DOM 元素（可能还在渲染中或被过滤），不绘制
  if (!fromEl || !toEl) return ''

  // 2. 获取坐标信息 (Viewport Coordinate System)
  const containerRect = props.containerRef.getBoundingClientRect()
  const fromRect = actualFromEl.getBoundingClientRect()
  const toRect = toEl.getBoundingClientRect()

  // 3. 获取滚动偏移量
  // getBoundingClientRect 是相对于视口的，不包含滚动距离。
  // 必须加上 scrollLeft/scrollTop 才能换算成容器内部的绝对坐标。
  const scrollLeft = props.containerRef.scrollLeft || 0
  const scrollTop = props.containerRef.scrollTop || 0

  // 4. 坐标空间转换公式：
  // 绝对X = (元素左边 - 容器左边) + 容器水平滚动
  // 绝对Y = (元素顶部 - 容器顶部) + 容器垂直滚动 + 半高(垂直居中)
  const x1 = (fromRect.right - containerRect.left) + scrollLeft
  const y1 = (fromRect.top - containerRect.top) + scrollTop + (fromRect.height / 2)

  const x2 = (toRect.left - containerRect.left) + scrollLeft
  const y2 = (toRect.top - containerRect.top) + scrollTop + (toRect.height / 2)

  // 5. 路径生成策略：正交折线 (Orthogonal Routing)
  // 路径走法：起点 -> 向右固定距离 -> 垂直移动 -> 终点
  // 如果想改回曲线，可以将 'L' 命令改为 'C' (Cubic Bezier) 并计算控制点
  const currentWidth = store.timeBlockWidth
  // 转折点位置：在终点左侧半个单位宽度处进行垂直转折
  const fixedWidth = 0.5 * currentWidth
  const x_vertical = x2 - fixedWidth

  // M(起点) -> L(转折点上) -> L(转折点下) -> L(终点)
  return `M ${x1} ${y1} L ${x_vertical} ${y1} L ${x_vertical} ${y2} L ${x2} ${y2}`
})
</script>

<template>
  <g>
    <path
        :d="pathData"
        fill="none"
        stroke="#ffd700"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="connector-path"
    />
  </g>
</template>

<style scoped>
.connector-path {
  pointer-events: visibleStroke;
  transition: stroke-width 0.2s;
}

.connector-path:hover {
  stroke-width: 3;
  stroke: #ffe550;
}
</style>