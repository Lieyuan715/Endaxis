<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import html2canvas from 'html2canvas'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'

// 组件引入
import TimelineGrid from '../components/TimelineGrid.vue'
import ActionLibrary from '../components/ActionLibrary.vue'
import PropertiesPanel from '../components/PropertiesPanel.vue'
import SpMonitor from '../components/SpMonitor.vue'
import StaggerMonitor from '../components/StaggerMonitor.vue'

const store = useTimelineStore()

// === 关于弹窗逻辑 ===
const aboutDialogVisible = ref(false)

// 用户第一次访问时自动弹出
onMounted(() => {
  const hasSeenIntro = localStorage.getItem('endaxis_has_seen_intro')
  if (!hasSeenIntro) {
    aboutDialogVisible.value = true
    localStorage.setItem('endaxis_has_seen_intro', 'true')
  }
})

// === 文件导入相关 ===
const fileInputRef = ref(null)

function triggerImport() {
  if (fileInputRef.value) fileInputRef.value.click()
}

async function onFileSelected(event) {
  const file = event.target.files[0]
  if (!file) return

  try {
    const success = await store.importProject(file)
    if (success) ElMessage.success('项目加载成功！')
  } catch (e) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    // 清空 input，以便下次可以选择同名文件
    event.target.value = ''
  }
}

// === 导出长图相关 ===
const exportDialogVisible = ref(false)
const exportForm = ref({ filename: '', duration: 60 })

function openExportDialog() {
  const dateStr = new Date().toISOString().slice(0, 10)
  exportForm.value.filename = `Endaxis_Timeline_${dateStr}`
  // 默认导出前 60秒
  exportForm.value.duration = 60
  exportDialogVisible.value = true
}

async function processExport() {
  exportDialogVisible.value = false
  const userDuration = exportForm.value.duration
  let userFilename = exportForm.value.filename || 'Endaxis_Export'
  if (!userFilename.toLowerCase().endsWith('.png')) userFilename += '.png'

  const durationSeconds = userDuration
  const pixelsPerSecond = store.timeBlockWidth
  const sidebarWidth = 180
  const rightMargin = 50

  // 计算需要渲染的总宽度
  const contentWidth = durationSeconds * pixelsPerSecond
  const totalWidth = sidebarWidth + contentWidth + rightMargin

  const loading = ElLoading.service({
    lock: true,
    text: `正在渲染前 ${durationSeconds} 秒的长图...`,
    background: 'rgba(0, 0, 0, 0.9)'
  })

  // 记录原始滚动位置
  const originalScrollLeft = store.timelineScrollLeft

  // 获取关键DOM元素
  const workspaceEl = document.querySelector('.timeline-workspace')
  const timelineMain = document.querySelector('.timeline-main')
  const gridLayout = document.querySelector('.timeline-grid-layout')
  const scrollers = document.querySelectorAll('.tracks-content-scroller, .chart-scroll-wrapper, .timeline-grid-container')
  const tracksContent = document.querySelector('.tracks-content')

  // 备份样式
  const styleMap = new Map()
  const backupStyle = (el) => { if (el) styleMap.set(el, el.style.cssText) }
  backupStyle(workspaceEl); backupStyle(timelineMain); backupStyle(gridLayout); backupStyle(tracksContent)
  scrollers.forEach(el => backupStyle(el))

  try {
    // 1. 强制滚动回零
    store.setScrollLeft(0)
    scrollers.forEach(el => el.scrollLeft = 0)
    await new Promise(resolve => setTimeout(resolve, 100))

    // 2. 强制展开容器宽度
    if (timelineMain) { timelineMain.style.width = `${totalWidth}px`; timelineMain.style.overflow = 'visible'; }
    if (workspaceEl) { workspaceEl.style.width = `${totalWidth}px`; workspaceEl.style.overflow = 'visible'; }
    if (gridLayout) {
      gridLayout.style.width = `${totalWidth}px`
      gridLayout.style.display = 'grid'
      gridLayout.style.gridTemplateColumns = `${sidebarWidth}px ${contentWidth + rightMargin}px`
      gridLayout.style.overflow = 'visible'
    }
    scrollers.forEach(el => { el.style.width = '100%'; el.style.overflow = 'visible'; el.style.maxWidth = 'none' })

    // 3. 强制展开 SVG 画布
    if (tracksContent) {
      tracksContent.style.width = `${contentWidth}px`
      tracksContent.style.minWidth = `${contentWidth}px`
      const svgs = tracksContent.querySelectorAll('svg')
      svgs.forEach(svg => {
        svg.style.width = `${contentWidth}px`
        svg.setAttribute('width', contentWidth)
      })
    }

    // 等待渲染刷新
    await new Promise(resolve => setTimeout(resolve, 400))

    // 4. 开始截图
    const canvas = await html2canvas(workspaceEl, {
      backgroundColor: '#282828',
      scale: 1.5, // 提高清晰度
      width: totalWidth,
      height: workspaceEl.scrollHeight + 20,
      windowWidth: totalWidth,
      useCORS: true,
      logging: false
    })

    // 5. 下载
    const link = document.createElement('a')
    link.download = userFilename
    link.href = canvas.toDataURL('image/png')
    link.click()
    ElMessage.success(`长图已导出：${userFilename}`)

  } catch (error) {
    console.error(error)
    ElMessage.error('导出失败：' + error.message)
  } finally {
    // 6. 恢复现场
    styleMap.forEach((cssText, el) => el.style.cssText = cssText)
    store.setScrollLeft(originalScrollLeft)
    loading.close()
  }
}

// === 重置与快捷键 ===
function handleReset() {
  ElMessageBox.confirm(
      '确定要清空当前所有进度吗？此操作无法撤销，且会清除浏览器缓存。',
      '警告',
      {
        confirmButtonText: '确定清空',
        cancelButtonText: '取消',
        type: 'warning',
      }
  ).then(() => {
    store.resetProject()
    ElMessage.success('项目已重置')
  }).catch(() => {})
}

function handleGlobalKeydown(e) {
  const target = e.target
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
  if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); store.undo(); ElMessage.info({ message: '已撤销', duration: 800 }); return }
  if ((e.ctrlKey && (e.key === 'y' || e.key === 'Y')) || (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z'))) { e.preventDefault(); store.redo(); ElMessage.info({message: '已重做', duration: 800}); return }
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); store.copySelection(); ElMessage.success({message: '已复制', duration: 1000}); return }
  if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); store.pasteSelection(); ElMessage.success({message: '已粘贴', duration: 1000}); return }
  if (e.ctrlKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); store.toggleCursorGuide(); ElMessage.info({ message: store.showCursorGuide ? '辅助线：开启' : '辅助线：隐藏', duration: 1500 }); return }
  if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); store.toggleBoxSelectMode(); ElMessage.info({ message: store.isBoxSelectMode ? '框选模式：开启' : '框选模式：关闭', duration: 1500 }); return }
  if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); store.toggleSnapStep(); ElMessage.info({ message: `吸附精度：${store.snapStep}s`,  duration: 1000 }); return }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => { window.removeEventListener('keydown', handleGlobalKeydown) })
</script>

<template>
  <div v-if="store.isLoading" class="loading-screen">
    <div class="loading-content">
      <div class="spinner"></div>
      <p>正在加载资源...</p>
    </div>
  </div>

  <div v-if="!store.isLoading" class="app-layout">
    <aside class="action-library"><ActionLibrary/></aside>

    <main class="timeline-main">
      <header class="timeline-header" @click="store.selectTrack(null)">
        <div class="header-controls">
          <input type="file" ref="fileInputRef" style="display: none" accept=".json" @change="onFileSelected" />

          <button class="control-btn info-btn" @click="aboutDialogVisible = true" title="查看教程与项目信息">
            ℹ️ 关于
          </button>

          <div class="divider-vertical"></div>

          <button class="control-btn danger-btn" @click="handleReset" title="清空所有内容">🗑️ 重置</button>
          <div class="divider-vertical"></div>

          <button class="control-btn export-img-btn" @click="openExportDialog" title="导出为PNG长图">📷 导出图片</button>
          <div class="divider-vertical"></div>

          <button class="control-btn load-btn" @click="triggerImport" title="导入 .json 项目文件">📂 加载</button>
          <button class="control-btn save-btn" @click="store.exportProject" title="保存为 .json 文件">💾 保存</button>
        </div>
      </header>

      <div class="timeline-workspace">
        <div class="timeline-grid-container"><TimelineGrid/></div>
        <div class="stagger-monitor-panel"><StaggerMonitor/></div>
        <div class="sp-monitor-panel"><SpMonitor/></div>
      </div>
    </main>

    <aside class="properties-sidebar"><PropertiesPanel/></aside>

    <el-dialog v-model="exportDialogVisible" title="导出长图设置" width="420px" align-center class="custom-dialog">
      <div class="export-form">
        <div class="form-item"><label>文件名称</label><el-input v-model="exportForm.filename" placeholder="请输入文件名" size="large"/></div>
        <div class="form-item"><label>导出时长 (秒)</label><el-input-number v-model="exportForm.duration" :min="10" :max="store.TOTAL_DURATION" :step="10" size="large" style="width: 100%;"/><div class="hint">最大支持 {{ store.TOTAL_DURATION }}s</div></div>
      </div>
      <template #footer><span class="dialog-footer"><el-button @click="exportDialogVisible = false">取消</el-button><el-button type="primary" @click="processExport">开始导出</el-button></span></template>
    </el-dialog>

    <el-dialog
        v-model="aboutDialogVisible"
        title="关于 Endaxis"
        width="500px"
        align-center
        class="custom-dialog"
    >
      <div class="about-content">
        <div class="about-section">
          <h3>欢迎使用</h3>
          <p>Endaxis 是一个专为《明日方舟：终末地》设计的可视化排轴工具。你可以通过拖拽技能、建立连线关系来规划战术流程。</p>
        </div>

        <div class="about-section">
          <h3>🔗 链接与资源</h3>
          <ul class="link-list">
            <li>
              <span class="link-label">📺 视频教程：</span>
              <a href="#" target="_blank" class="highlight-link">
                点击观看 Bilibili 教程 (待补充)
              </a>
            </li>
            <li>
              <span class="link-label">📝 文本教程：</span>
              <a href="https://gx3qqg8r3jk.feishu.cn/wiki/TUTyw3s32iPsAXkCfl0cCE0VnOj" target="_blank" class="highlight-link">
                点击查看使用文档
              </a>
            </li>
            <li>
              <span class="link-label">💻 项目仓库：</span>
              <a href="https://github.com/Lieyuan621/Endaxis" target="_blank" class="highlight-link">
                GitHub 仓库
              </a>
            </li>
          </ul>
        </div>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button type="primary" @click="aboutDialogVisible = false">开始使用</el-button>
        </span>
      </template>
    </el-dialog>

  </div>
</template>

<style scoped>
/* App Layout */
.app-layout { display: grid; grid-template-columns: 200px 1fr 250px; grid-template-rows: 100vh; height: 100vh; overflow: hidden; background-color: #2c2c2c; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
.action-library { background-color: #333; border-right: 1px solid #444; display: flex; flex-direction: column; overflow-y: auto; z-index: 10; }
.timeline-main { display: flex; flex-direction: column; overflow: hidden; background-color: #282828; z-index: 1; border-right: 1px solid #444; }
.properties-sidebar { background-color: #333; overflow: hidden; z-index: 10; }

/* Header */
.timeline-header { height: 50px; flex-shrink: 0; border-bottom: 1px solid #444; background-color: #3a3a3a; display: flex; align-items: center; justify-content: flex-end; /* 改为靠右对齐，因为移除了左侧缩放 */ padding: 0 20px; cursor: default; user-select: none; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }

.header-controls { display: flex; align-items: center; gap: 10px; }
.divider-vertical { width: 1px; height: 20px; background-color: #555; margin: 0 5px; }

/* Buttons */
.control-btn { padding: 6px 14px; border: 1px solid #555; background-color: #444; color: #f0f0f0; border-radius: 4px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px; transition: all 0.2s ease; font-weight: 500; }
.control-btn:hover { background-color: #555; border-color: #777; transform: translateY(-1px); }
.control-btn:active { transform: translateY(1px); }

/* Button Colors */
.save-btn:hover { border-color: #4CAF50; color: #4CAF50; background-color: rgba(76, 175, 80, 0.1); }
.load-btn:hover { border-color: #4a90e2; color: #4a90e2; background-color: rgba(74, 144, 226, 0.1); }
.export-img-btn:hover { border-color: #e6a23c; color: #e6a23c; background-color: rgba(230, 162, 60, 0.1); }
.danger-btn:hover { border-color: #ff7875; color: #ff7875; background-color: rgba(255, 77, 79, 0.1); }

/* 关于按钮颜色 */
.info-btn:hover {
  border-color: #00e5ff;
  color: #00e5ff;
  background-color: rgba(0, 229, 255, 0.1);
}

/* Workspace & Panels */
.timeline-workspace { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; }
.timeline-grid-container { flex-grow: 1; overflow: hidden; min-height: 0; }
.stagger-monitor-panel { height: 60px; flex-shrink: 0; border-top: 1px solid #444; z-index: 20; background: #252525; }
.sp-monitor-panel { height: 140px; flex-shrink: 0; border-top: 1px solid #444; z-index: 20; background: #252525; }

/* Loading */
.loading-screen { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #18181c; z-index: 9999; display: flex; align-items: center; justify-content: center; color: #888; font-size: 14px; }
.loading-content { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.spinner { width: 30px; height: 30px; border: 3px solid #333; border-top-color: #ffd700; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Export Dialog Styles */
.export-form { display: flex; flex-direction: column; gap: 20px; padding: 10px 0; }
.form-item label { display: block; margin-bottom: 8px; font-weight: bold; color: #ccc; }
.hint { font-size: 12px; color: #888; margin-top: 6px; }

/* 关于弹窗内容样式 */
.about-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  color: #ccc;
  line-height: 1.6;
}

.about-section h3 {
  margin: 0 0 10px 0;
  color: #ffd700;
  font-size: 15px;
  border-left: 3px solid #ffd700;
  padding-left: 8px;
}

.about-section p { margin: 0; font-size: 13px; }

.link-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.link-list li { display: flex; align-items: center; font-size: 13px; }

.link-label { color: #aaa; margin-right: 5px; }

.highlight-link {
  color: #00e5ff;
  text-decoration: none;
  border-bottom: 1px dashed rgba(0, 229, 255, 0.5);
  transition: all 0.2s;
}

.highlight-link:hover { color: #fff; border-bottom-style: solid; }

.notice-text {
  background: rgba(255, 255, 255, 0.05);
  padding: 10px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  color: #aaa;
}

/* Dark Mode Adapter for Element Plus Dialog */
:deep(.el-dialog) { background-color: #2b2b2b; border: 1px solid #444; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
:deep(.el-dialog__header) { margin-right: 0; border-bottom: 1px solid #3a3a3a; padding: 15px 20px; }
:deep(.el-dialog__title) { color: #f0f0f0; font-size: 16px; font-weight: 600; }
:deep(.el-dialog__body) { color: #ccc; padding: 25px 25px 10px 25px; }
:deep(.el-dialog__footer) { padding: 15px 25px 20px; border-top: 1px solid #3a3a3a; }
:deep(.el-input__wrapper) { background-color: #1f1f1f; box-shadow: 0 0 0 1px #444 inset; padding: 4px 11px; }
:deep(.el-input__inner) { color: white; height: 36px; line-height: 36px; }
:deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px #666 inset; }
:deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px #ffd700 inset; }
:deep(.el-button) { background: #3a3a3a; border-color: #555; color: #ccc; height: 36px; display: inline-flex; justify-content: center; align-items: center; border-bottom: none !important; outline: none !important; }
:deep(.el-button:hover) { background: #444; color: white; border-color: #777; }
:deep(.el-button--primary) { background: #ffd700; border-color: #ffd700; color: #000; font-weight: bold; }
:deep(.el-button--primary:hover) { background: #ffec3d; border-color: #ffec3d; color: #000; }
</style>