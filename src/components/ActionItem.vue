<script setup>
import { computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import { storeToRefs } from 'pinia'

/**
 * 组件：ActionItem (动作块)
 * 作用：在 TimelineGrid 中渲染单个技能/动作块
 * 功能：显示名称、样式分类、选中状态、冷却条、异常状态条以及删除按钮
 */
const props = defineProps({
  action: { type: Object, required: true }
})

// 1. 数据源获取
const store = useTimelineStore()
const { iconDatabase } = storeToRefs(store)

const isSelected = computed(() => store.selectedActionId === props.action.instanceId)

/**
 * 计算属性：动态样式类
 * 根据动作类型 (link/execution/normal) 决定边框颜色
 */
const typeClass = computed(() => {
  switch (props.action.type) {
    case 'link': return 'style-link'
    case 'execution': return 'style-execution'
    default: return 'style-normal'
  }
})

/**
 * 计算属性：主容器样式
 * 负责计算动作块在时间轴上的绝对位置 (left) 和宽度 (width)
 * 依赖 store.timeBlockWidth 实现响应式缩放
 */
const style = computed(() => {
  const widthUnit = store.timeBlockWidth

  // 坐标计算：时间 * 单位宽度
  const left = (props.action.startTime || 0) * widthUnit
  const width = (props.action.duration || 1) * widthUnit

  // 最小宽度保护，防止持续时间极短时不可见
  const finalWidth = width < 2 ? 2 : width

  return {
    position: 'absolute', top: '0', height: '100%',
    left: `${left}px`, width: `${finalWidth}px`,
    // 选中高亮样式
    border: isSelected.value ? '2px solid #ffaa00' : undefined,
    boxSizing: 'border-box', zIndex: isSelected.value ? 20 : 10,
  }
})

/**
 * 计算属性：冷却条样式
 * 绘制在动作块下方的细线，指示冷却时间长度
 */
const cdStyle = computed(() => {
  const widthUnit = store.timeBlockWidth
  const cd = props.action.cooldown || 0
  // 宽度稍微加宽一点(+1单位)，视觉上更舒适
  const width = cd > 0 ? (cd + 1) * widthUnit : 0
  return { width: `${width}px`, bottom: '-8px', left: '0' }
})

/**
 * 计算异常状态条 (Anomaly Bar) 的样式
 * * 布局策略：
 * 异常状态条悬浮在动作块上方，形成“阶梯状”排列，避免遮挡。
 * 每多一个 Buff，bottomOffset 增加 50%，实现垂直堆叠。
 * * @param {Object} effect 异常状态对象 {duration, type, ...}
 * @param {number} index 当前异常状态在列表中的索引
 */
function getAnomalyBarStyle(effect, index) {
  const widthUnit = store.timeBlockWidth
  const duration = effect.duration || 0
  const bottomOffset = 100 + (index * 50)
  return {
    width: `calc(${duration * widthUnit}px + 20px)`, // 20px 是图标的固定宽度
    bottom: `${bottomOffset}%`,
    left: 'calc(100% - 20px)', // 从动作块右侧边缘向内收缩 20px 开始绘制
    position: 'absolute',
    marginBottom: '4px',
    zIndex: 15 + index
  }
}

/**
 * 获取图标路径
 * * 查找逻辑：
 * 1. 优先查找当前角色是否有“专属 Buff 图标” (例如 Endministrator 的 crystallize)。
 * 2. 如果没有专属，则去全局 ICON_DATABASE 查找通用图标。
 * 3. 都没有则返回默认图标。
 */
function getIconPath(type) {
  let charId = null;
  // 反查当前动作块所属的干员 ID
  for (const track of store.tracks) {
    if (track.actions.some(a => a.instanceId === props.action.instanceId)) { charId = track.id; break; }
  }

  if (charId) {
    const charInfo = store.characterRoster.find(c => c.id === charId);
    if (charInfo && charInfo.exclusive_buffs) {
      const exclusive = charInfo.exclusive_buffs.find(b => b.key === type);
      if (exclusive && exclusive.path) return exclusive.path;
    }
  }
  // 全局回退逻辑
  return (iconDatabase.value && iconDatabase.value[type]) ? iconDatabase.value[type] : (iconDatabase.value?.['default'] || '');
}

function onDeleteClick() {
  store.removeAction(props.action.instanceId)
}
</script>

<template>
  <div
      :id="`action-${action.instanceId}`"
      class="action-item-wrapper"
      :class="typeClass"
      :style="style"
      @click.stop
  >
    <div class="action-item-content drag-handle">{{ action.name }}</div>

    <div v-if="isSelected" class="delete-btn-modern" @click.stop="onDeleteClick" title="删除">
      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </div>

    <div v-if="action.cooldown > 0" class="cd-bar-container" :style="cdStyle">
      <div class="cd-line"></div><span class="cd-text">{{ action.cooldown }}s</span><div class="cd-end-mark"></div>
    </div>

    <div class="anomalies-overlay">
      <div v-for="(effect, index) in action.physicalAnomaly" :key="index" class="anomaly-row" :style="getAnomalyBarStyle(effect, index)">

        <div class="anomaly-icon-box"
             :id="`anomaly-${action.instanceId}-${index}`"
             @click.stop="store.selectAction(action.instanceId)"
        >
          <img :src="getIconPath(effect.type)" class="anomaly-icon" />
          <div v-if="effect.stacks > 1" class="anomaly-stacks">{{ effect.stacks }}</div>
        </div>

        <div class="anomaly-duration-bar" v-if="effect.duration > 0">
          <div class="striped-bg"></div><span class="duration-text">{{ effect.duration }}s</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 基础容器：相对定位，启用 Flex 居中 */
.action-item-wrapper { display: flex; align-items: center; justify-content: center; background-color: #4f4f4f; color: white; border: 2px dashed #ffffff; white-space: nowrap; cursor: grab; user-select: none; -webkit-user-select: none; position: relative; overflow: visible; }
.action-item-wrapper:hover { background-color: #5a5a5a; }

/* 类型差异化样式 */
.style-normal { border: 2px dashed #e0e0e0; background-color: #4f4f4f; }
.style-link { border: 2px dashed #ffd700 !important; background-color: #4f4f4f; color: #ffd700; }
.style-execution { border: 2px dashed #ff4d4f !important; background-color: #4f4f4f; color: #ff4d4f; }

/* 异常状态层交互逻辑：
   1. .anomalies-overlay 设置 pointer-events: none，让鼠标点击可以穿透到下方的动作块，从而实现拖拽动作块。
   2. .anomaly-icon-box 设置 pointer-events: auto，重新拦截鼠标点击，从而允许用户点击小图标来发起/接收连线。
*/
.anomalies-overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.anomaly-row { display: flex; align-items: center; height: 22px; pointer-events: none; }

.anomaly-icon-box { width: 20px; height: 20px; background-color: #333; border: 1px solid #999; box-sizing: border-box; display: flex; align-items: center; justify-content: center; position: relative; z-index: 2; flex-shrink: 0; pointer-events: auto; cursor: pointer;}
.anomaly-icon { width: 100%; height: 100%; object-fit: cover; }
.anomaly-stacks { position: absolute; bottom: -2px; right: -2px; background-color: rgba(0,0,0,0.8); color: #ffd700; font-size: 8px; padding: 0 2px; border-radius: 2px; line-height: 1; }

.anomaly-duration-bar { flex-grow: 1; height: 14px; background-color: rgba(255, 255, 255, 0.2); border: 1px solid rgba(255, 255, 255, 0.4); border-left: none; position: relative; display: flex; align-items: center; overflow: hidden; box-sizing: border-box; }
.striped-bg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255, 255, 255, 0.1) 4px, rgba(255, 255, 255, 0.1) 8px); z-index: 1; }
.duration-text { position: absolute; left: 4px; font-size: 10px; color: #fff; text-shadow: 1px 1px 2px black; z-index: 2; font-weight: bold; line-height: 1; }

/* 冷却条样式 */
.cd-bar-container { position: absolute; height: 4px; display: flex; align-items: center; pointer-events: none; }
.cd-line { flex-grow: 1; height: 2px; background-color: #ffd700; margin-top: 1px; opacity: 0.3; }
.cd-text { position: absolute; left: 0; top: 4px; font-size: 10px; color: #ffd700; font-weight: bold; line-height: 1; }
.cd-end-mark { position: absolute; right: 0; top: -2px; width: 1px; height: 8px; background-color: #ffd700; }

/* 删除按钮样式 */
.delete-btn-modern { position: absolute; top: -8px; right: -8px; width: 18px; height: 18px; background-color: #333; border: 1px solid #666; color: #ccc; border-radius: 4px; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 30; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4); transition: all 0.2s ease; }
.delete-btn-modern:hover { background-color: #d32f2f; border-color: #d32f2f; color: white; transform: scale(1.1); }
</style>