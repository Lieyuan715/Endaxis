<script setup>
import TimelineGrid from '../components/TimelineGrid.vue'
import ActionLibrary from '../components/ActionLibrary.vue'
import PropertiesPanel from '../components/PropertiesPanel.vue'
import SpMonitor from '../components/SpMonitor.vue'
import html2canvas from 'html2canvas'
import { ElLoading, ElMessage } from 'element-plus'
import { onMounted, ref } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

/**
 * 组件：TimelineEditor (主界面)
 * 作用：应用的主容器，负责三栏布局 (库/主画布/属性) 的组装。
 * 核心功能：
 * 1. 布局管理：Grid + Flex 复合布局。
 * 2. 全局控制：缩放、保存、读取、导出图片。
 * 3. 导出长图引擎：实现了一个复杂的“展开-截图-还原”流程，支持导出超长排轴图。
 */

const store = useTimelineStore()
const fileInputRef = ref(null)

onMounted(() => {
  store.fetchGameData()
})

function triggerImport() {
  if (fileInputRef.value) {
    fileInputRef.value.click()
  }
}

async function onFileSelected(event) {
  const file = event.target.files[0]
  if (!file) return

  try {
    await store.importProject(file)
    ElMessage.success('项目加载成功！')
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    event.target.value = ''
  }
}

/**
 * 核心功能：导出高清长图
 * 原理：HTML2Canvas 无法截取 overflow:scroll 内部被隐藏的内容。
 * 策略：
 * 1. [Freeze]: 锁定界面，显示 Loading。
 * 2. [Expand]: 强制将所有滚动容器的 width/height 设为内容实际尺寸 (overflow: visible)，使整个时间轴在 DOM 上完全展开。
 * 3. [Patch]: 临时隐藏 ElementUI 的复杂组件 (Select)，替换为纯文本 Label 以修正渲染偏差。
 * 4. [Capture]: 截图。
 * 5. [Restore]: 恢复所有 DOM 样式到初始状态。
 */
async function exportAsImage() {
  // 1. 计算画布总尺寸
  // 预设导出 65秒 的长度，确保包含结尾
  const durationSeconds = store.TOTAL_DURATION + 5
  const pixelsPerSecond = store.timeBlockWidth
  const sidebarWidth = 180
  const rightMargin = 100
  const contentWidth = durationSeconds * pixelsPerSecond
  const totalWidth = sidebarWidth + contentWidth + rightMargin

  const loading = ElLoading.service({
    lock: true,
    text: '正在进行像素级对齐并渲染长图...',
    background: 'rgba(0, 0, 0, 0.9)',
  })

  // === 阶段 A: 状态备份 (Snapshot State) ===
  const originalScrollLeft = store.timelineScrollLeft

  // 获取关键 DOM 节点
  const workspaceEl = document.querySelector('.timeline-workspace')
  const timelineMain = document.querySelector('.timeline-main')
  const gridLayout = document.querySelector('.timeline-grid-layout')
  const scrollers = document.querySelectorAll('.tracks-content-scroller, .chart-scroll-wrapper, .timeline-grid-container')
  const tracksContent = document.querySelector('.tracks-content')

  // 样式备份 Map (Element -> cssText)
  const styleMap = new Map()
  const backupStyle = (el) => { if (el) styleMap.set(el, el.style.cssText) }

  backupStyle(workspaceEl)
  backupStyle(timelineMain)
  backupStyle(gridLayout)
  backupStyle(tracksContent)
  scrollers.forEach(el => backupStyle(el))

  // 临时创建的 DOM 元素引用 (用于后续清理)
  const hiddenSelects = []
  const tempLabels = []
  const modifiedRows = [] // 记录被修改过样式的行

  try {
    // === 阶段 B: 归位与展开 (Reset & Expand) ===
    store.setScrollLeft(0)
    scrollers.forEach(el => el.scrollLeft = 0)
    // 等待 Vue/DOM 滚动归零
    await new Promise(resolve => setTimeout(resolve, 100))

    // 强制展开容器宽度
    if (timelineMain) { timelineMain.style.width = `${totalWidth}px`; timelineMain.style.overflow = 'visible'; }
    if (workspaceEl) { workspaceEl.style.width = `${totalWidth}px`; workspaceEl.style.overflow = 'visible'; }

    // 展开 Grid 布局
    if (gridLayout) {
      gridLayout.style.width = `${totalWidth}px`
      gridLayout.style.display = 'grid'
      gridLayout.style.gridTemplateColumns = `${sidebarWidth}px ${contentWidth + rightMargin}px`
      gridLayout.style.overflow = 'visible'
    }

    // 展开所有滚动层
    scrollers.forEach(el => {
      el.style.width = '100%'
      el.style.overflow = 'visible'
      el.style.maxWidth = 'none'
    })

    // 修正 SVG 和内容区宽度
    if (tracksContent) {
      tracksContent.style.width = `${contentWidth}px`
      tracksContent.style.minWidth = `${contentWidth}px`
      const svgs = tracksContent.querySelectorAll('svg')
      svgs.forEach(svg => {
        svg.style.width = `${contentWidth}px`
        svg.setAttribute('width', contentWidth)
      })
    }

    // === 阶段 C: 像素级修补 (Pixel Perfect Patching) ===
    // 目标：解决左侧表头 (Header) 与右侧轨道 (Content) 在截图时的微小错位问题
    const rows = document.querySelectorAll('.track-info')

    store.teamTracksInfo.forEach((info, index) => {
      const row = rows[index]
      if (!row) return

      // [修补 1] 结构对齐
      // 备份当前行样式
      backupStyle(row)
      modifiedRows.push(row)

      // 给左侧 Header 行添加与右侧 Track 行相同的 2px 透明边框。
      // 原因：右侧 Track 行有 border-top/bottom 用于高亮 Drop 区域，
      // 如果左侧没有，会导致截图时高度不一致，从而产生错位。
      row.style.borderTop = '2px solid transparent'
      row.style.borderBottom = '2px solid transparent'
      row.style.boxSizing = 'border-box'

      // [修补 2] 替换控件
      // html2canvas 渲染 ElementUI Select 组件效果极差，直接替换为纯文本
      const select = row.querySelector('.character-select')
      if (select) {
        select.style.display = 'none'
        hiddenSelects.push(select)

        const label = document.createElement('div')
        label.innerText = info.name || '未选择'

        // 模拟文本样式
        Object.assign(label.style, {
          color: '#f0f0f0',
          fontSize: '16px',
          fontWeight: 'bold',
          height: '50px',
          lineHeight: '50px',
          paddingLeft: '10px',
          flexGrow: '1',
          whiteSpace: 'nowrap',
          fontFamily: 'sans-serif',
          // 微调：抵消字体渲染基线差异，使文字视觉垂直居中
          marginTop: '15px'
        })

        row.appendChild(label)
        tempLabels.push(label)
      }
    })

    // 给 DOM 重排留出缓冲时间
    await new Promise(resolve => setTimeout(resolve, 400))

    // === 阶段 D: 截图 (Capture) ===
    const canvas = await html2canvas(workspaceEl, {
      backgroundColor: '#282828',
      scale: 1.5, // 1.5倍清晰度
      width: totalWidth,
      height: workspaceEl.scrollHeight + 20, // 略微多截一点底部防止切边
      windowWidth: totalWidth,
      useCORS: true,
      logging: false
    })

    // === 阶段 E: 下载 (Download) ===
    const link = document.createElement('a')
    link.download = `Endaxis_Full_${new Date().toISOString().slice(0,10)}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()

    ElMessage.success('高清长图导出成功！')

  } catch (error) {
    console.error(error)
    ElMessage.error('导出失败：' + error.message)
  } finally {
    // === 阶段 F: 恢复现场 (Restore) ===
    // 1. 移除临时 Label
    tempLabels.forEach(el => el.remove())
    // 2. 显示 Select
    hiddenSelects.forEach(el => el.style.display = '')
    // 3. 恢复所有被修改过的 DOM 样式 (包括容器宽高等)
    styleMap.forEach((cssText, el) => el.style.cssText = cssText)

    // 4. 恢复滚动位置
    store.setScrollLeft(originalScrollLeft)
    loading.close()
  }
}
</script>

<template>
  <div v-if="store.isLoading" class="loading-screen">
    正在加载游戏数据...
  </div>

  <div v-if="!store.isLoading" class="app-layout">

    <aside class="action-library">
      <ActionLibrary/>
    </aside>

    <main class="timeline-main">
      <header class="timeline-header" @click="store.selectTrack(null)">
        <span class="header-title">控制区</span>

        <div class="zoom-controls">
          <span class="zoom-label">🔍 缩放</span>
          <el-slider
              v-model="store.zoomLevel"
              :min="0.2"
              :max="2.0"
              :step="0.1"
              :format-tooltip="(val) => `${Math.round(val * 100)}%`"
              size="small"
              style="width: 100px"
          />
        </div>

        <div class="header-controls">
          <button class="control-btn export-img-btn" @click="exportAsImage">
            📷 导出图片
          </button>

          <button class="control-btn save-btn" @click="store.exportProject">
            💾 保存项目
          </button>
          <button class="control-btn load-btn" @click="triggerImport">
            📂 读取项目
          </button>
          <input
              type="file"
              ref="fileInputRef"
              style="display: none"
              accept=".json"
              @change="onFileSelected"
          />
        </div>
      </header>

      <div class="timeline-workspace">
        <div class="timeline-grid-container">
          <TimelineGrid/>
        </div>

        <div class="sp-monitor-panel">
          <SpMonitor/>
        </div>
      </div>
    </main>

    <aside class="properties-sidebar">
      <PropertiesPanel/>
    </aside>

  </div>
</template>

<style scoped>
/* 全局 Loading */
.loading-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100vw;
  height: 100vh;
  font-size: 20px;
  color: #f0f0f0;
}

/* === 整体布局：三栏 Grid === */
.app-layout {
  display: grid;
  grid-template-columns: 200px 1fr 250px; /* 左 中 右 */
  grid-template-rows: 100vh;
  height: 100vh;
  overflow: hidden;
  background-color: #2c2c2c;
}

/* 左侧栏 */
.action-library {
  background-color: #333;
  border-right: 1px solid #444;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  z-index: 10;
}

/* 中间主区域 (Flex Column) */
.timeline-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: #282828;
  z-index: 1;
  border-right: 1px solid #444;
}

/* 顶部 Header */
.timeline-header {
  height: 50px;
  flex-shrink: 0;
  border-bottom: 1px solid #444;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background-color: #3a3a3a;
  cursor: default;
  user-select: none;
}

.header-title { font-weight: bold; color: #aaa; }
.header-controls { display: flex; gap: 10px; }

.control-btn {
  padding: 5px 12px;
  border: 1px solid #555;
  background-color: #444;
  color: #f0f0f0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 5px;
  transition: all 0.2s;
}
.control-btn:hover { background-color: #555; border-color: #777; }
.control-btn:active { transform: translateY(1px); }
.save-btn:hover { border-color: #4CAF50; color: #4CAF50; }
.load-btn:hover { border-color: #4a90e2; color: #4a90e2; }
.export-img-btn:hover { border-color: #e6a23c; color: #e6a23c; }

/* 缩放控件 */
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-right: 20px;
  background: #333;
  padding: 4px 12px;
  border-radius: 16px;
  border: 1px solid #444;
}
.zoom-label { font-size: 12px; color: #aaa; }

/* 组合工作区 (Grid + Monitor) */
.timeline-workspace {
  flex-grow: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.timeline-grid-container {
  flex-grow: 1;
  overflow: hidden;
  min-height: 0; /* 防止 flex 子项溢出 */
}

.sp-monitor-panel {
  height: 140px;
  flex-shrink: 0;
  border-top: 2px solid #444;
  z-index: 20;
}

/* 右侧栏 */
.properties-sidebar {
  background-color: #333;
  overflow: hidden;
  z-index: 10;
}
</style>