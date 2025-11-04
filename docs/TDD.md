# 音视频合成工具 - 技术设计文档 (TDD)

## 1. 技术概述

### 1.1 系统架构
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   浏览器客户端   │    │   Node.js服务器   │    │   CDN资源服务   │
│                │    │                 │    │                │
│  ┌───────────┐  │    │  ┌────────────┐  │    │  ┌───────────┐ │
│  │ HTML/CSS  │  │    │  │ HTTP Server│  │    │  │ FFmpeg.js │ │
│  └───────────┘  │    │  └────────────┘  │    │  └───────────┘ │
│  ┌───────────┐  │    │  ┌────────────┐  │    │  ┌───────────┐ │
│  │JavaScript │◄─┼────┼─►│Static Files│  │    │  │ Core Files│ │
│  └───────────┘  │    │  └────────────┘  │    │  └───────────┘ │
│  ┌───────────┐  │    │  ┌────────────┐  │    │                │
│  │FFmpeg.js  │◄─┼────┼──┤CORS Headers│  │    │                │
│  └───────────┘  │    │  └────────────┘  │    │                │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### 1.2 技术栈选型

#### 1.2.1 前端技术
- **HTML5**：现代语义化标签，File API 支持
- **CSS3**：响应式布局，现代样式特性
- **JavaScript ES6+**：原生 JS，避免框架复杂性
- **FFmpeg.js 0.11.0**：WebAssembly 音视频处理库

#### 1.2.2 后端技术
- **Node.js**：轻量级静态文件服务器
- **原生 HTTP 模块**：避免 Express 依赖，减少复杂性

#### 1.2.3 选型理由
| 技术 | 选择理由 | 替代方案 |
|------|----------|----------|
| 原生 JS | 轻量、兼容性好、学习成本低 | React/Vue（过于复杂） |
| FFmpeg.js | 功能强大、社区活跃、文档完善 | WebCodecs（兼容性差） |
| Node.js HTTP | 简单、可控、易部署 | Express（功能冗余） |

## 2. 系统设计

### 2.1 整体架构设计

#### 2.1.1 分层架构
```
┌─────────────────────────────────────────┐
│              表现层 (UI Layer)            │
│  ┌─────────────┐  ┌─────────────────────┐ │
│  │  HTML页面   │  │    CSS样式          │ │
│  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│            业务逻辑层 (Logic Layer)        │
│  ┌─────────────┐  ┌─────────────────────┐ │
│  │  文件处理   │  │    状态管理         │ │
│  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│            数据处理层 (Data Layer)         │
│  ┌─────────────┐  ┌─────────────────────┐ │
│  │  FFmpeg.js  │  │   虚拟文件系统      │ │
│  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│            基础设施层 (Infrastructure)     │
│  ┌─────────────┐  ┌─────────────────────┐ │
│  │  HTTP服务器 │  │   CORS配置          │ │
│  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────┘
```

#### 2.1.2 数据流设计
```
用户选择文件 → File API读取 → 写入VFS → FFmpeg处理 → 读取结果 → 触发下载
     ↓              ↓           ↓          ↓          ↓          ↓
   DOM事件      ArrayBuffer   FS.writeFile  ffmpeg.run  FS.readFile  Blob URL
```

### 2.2 核心模块设计

#### 2.2.1 文件管理模块
```javascript
class FileManager {
    constructor() {
        this.videoFile = null;
        this.audioFile = null;
    }
    
    // 文件验证
    validateFile(file, type) {
        const validators = {
            video: file => file.type === 'video/mp4',
            audio: file => file.type === 'audio/wav'
        };
        return validators[type](file);
    }
    
    // 文件读取
    async readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(new Uint8Array(e.target.result));
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
}
```

#### 2.2.2 FFmpeg 处理模块
```javascript
class FFmpegProcessor {
    constructor() {
        this.ffmpeg = createFFmpeg({ log: true });
        this.isLoaded = false;
    }
    
    // 初始化 FFmpeg
    async initialize() {
        if (!this.isLoaded) {
            await this.ffmpeg.load();
            this.isLoaded = true;
        }
    }
    
    // 音视频合成
    async mergeVideoAudio(videoData, audioData) {
        // 写入虚拟文件系统
        this.ffmpeg.FS('writeFile', 'input.mp4', videoData);
        this.ffmpeg.FS('writeFile', 'input.wav', audioData);
        
        // 执行合成命令
        await this.ffmpeg.run(
            '-i', 'input.mp4',
            '-i', 'input.wav',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',
            'output.mp4'
        );
        
        // 读取结果
        return this.ffmpeg.FS('readFile', 'output.mp4');
    }
}
```

#### 2.2.3 状态管理模块
```javascript
class StateManager {
    constructor() {
        this.state = {
            status: 'idle',
            progress: 0,
            error: null
        };
        this.listeners = [];
    }
    
    // 状态更新
    setState(newState) {
        this.state = { ...this.state, ...newState };
        this.notifyListeners();
    }
    
    // 监听器管理
    subscribe(listener) {
        this.listeners.push(listener);
    }
    
    notifyListeners() {
        this.listeners.forEach(listener => listener(this.state));
    }
}
```

## 3. 详细设计

### 3.1 前端设计

#### 3.1.1 HTML 结构设计
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>音视频合成工具</title>
</head>
<body>
    <div class="container">
        <header>
            <h1>🎬 音视频合成工具</h1>
        </header>
        
        <main>
            <div class="upload-section">
                <div class="input-group">
                    <label for="videoFile">选择视频文件 (MP4)</label>
                    <input type="file" id="videoFile" accept="video/mp4">
                </div>
                
                <div class="input-group">
                    <label for="audioFile">选择音频文件 (WAV)</label>
                    <input type="file" id="audioFile" accept="audio/wav">
                </div>
            </div>
            
            <div class="action-section">
                <button id="mergeBtn" disabled>开始合成</button>
            </div>
            
            <div class="status-section">
                <p id="status">请选择文件...</p>
            </div>
        </main>
    </div>
</body>
</html>
```

#### 3.1.2 CSS 样式设计
```css
/* 设计原则：简洁、现代、响应式 */
.container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.input-group {
    margin-bottom: 20px;
    padding: 15px;
    border: 2px dashed #ddd;
    border-radius: 8px;
    transition: border-color 0.3s;
}

.input-group:hover {
    border-color: #007bff;
}

button {
    background: linear-gradient(135deg, #007bff, #0056b3);
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    transition: all 0.3s;
}

button:disabled {
    background: #6c757d;
    cursor: not-allowed;
}

#status {
    padding: 15px;
    background: #f8f9fa;
    border-radius: 6px;
    font-weight: 500;
}
```

#### 3.1.3 JavaScript 架构设计
```javascript
// 主应用类
class VideoAudioMerger {
    constructor() {
        this.fileManager = new FileManager();
        this.ffmpegProcessor = new FFmpegProcessor();
        this.stateManager = new StateManager();
        this.ui = new UIController();
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.setupStateListener();
        this.checkCompatibility();
    }
    
    bindEvents() {
        document.getElementById('videoFile').addEventListener('change', 
            e => this.handleVideoSelect(e));
        document.getElementById('audioFile').addEventListener('change', 
            e => this.handleAudioSelect(e));
        document.getElementById('mergeBtn').addEventListener('click', 
            () => this.handleMerge());
    }
    
    async handleMerge() {
        try {
            this.stateManager.setState({ status: 'processing' });
            
            // 初始化 FFmpeg
            await this.ffmpegProcessor.initialize();
            
            // 读取文件
            const videoData = await this.fileManager.readFile(this.fileManager.videoFile);
            const audioData = await this.fileManager.readFile(this.fileManager.audioFile);
            
            // 合成处理
            const result = await this.ffmpegProcessor.mergeVideoAudio(videoData, audioData);
            
            // 下载结果
            this.downloadResult(result);
            
            this.stateManager.setState({ status: 'completed' });
        } catch (error) {
            this.stateManager.setState({ status: 'error', error: error.message });
        }
    }
}
```

### 3.2 后端设计

#### 3.2.1 HTTP 服务器设计
```javascript
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

class StaticServer {
    constructor(port = 3000) {
        this.port = port;
        this.mimeTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.wav': 'audio/wav',
            '.mp4': 'video/mp4',
            '.wasm': 'application/wasm'
        };
    }
    
    start() {
        const server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });
        
        server.listen(this.port, () => {
            console.log(`🚀 服务器运行在 http://localhost:${this.port}`);
        });
    }
    
    handleRequest(req, res) {
        // 设置 CORS 和 SharedArrayBuffer 支持头部
        this.setCORSHeaders(res);
        
        const parsedUrl = url.parse(req.url);
        let pathname = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
        
        this.serveStaticFile(pathname, res);
    }
    
    setCORSHeaders(res) {
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
    }
}
```

### 3.3 数据库设计
本项目为纯客户端应用，不需要数据库设计。所有数据处理都在浏览器内存中完成。

## 4. 接口设计

### 4.1 FFmpeg.js API 接口

#### 4.1.1 核心接口
```javascript
// FFmpeg 实例创建
const ffmpeg = createFFmpeg({
    log: boolean,           // 是否输出日志
    corePath?: string,      // 核心文件路径
    wasmPath?: string,      // WASM 文件路径
    workerPath?: string     // Worker 文件路径
});

// 加载 FFmpeg 核心
await ffmpeg.load();

// 检查加载状态
ffmpeg.isLoaded(): boolean

// 文件系统操作
ffmpeg.FS(method: string, ...args: any[]): any

// 执行 FFmpeg 命令
await ffmpeg.run(...args: string[]): Promise<void>
```

#### 4.1.2 文件系统接口
```javascript
// 写入文件到虚拟文件系统
ffmpeg.FS('writeFile', filename: string, data: Uint8Array): void

// 从虚拟文件系统读取文件
ffmpeg.FS('readFile', filename: string): Uint8Array

// 删除虚拟文件系统中的文件
ffmpeg.FS('unlink', filename: string): void

// 列出虚拟文件系统中的文件
ffmpeg.FS('readdir', path: string): string[]
```

### 4.2 浏览器 API 接口

#### 4.2.1 File API
```javascript
// 文件选择
<input type="file" accept="video/mp4,audio/wav">

// 文件读取
const reader = new FileReader();
reader.readAsArrayBuffer(file);
reader.onload = event => {
    const arrayBuffer = event.target.result;
    const uint8Array = new Uint8Array(arrayBuffer);
};
```

#### 4.2.2 Blob API
```javascript
// 创建 Blob 对象
const blob = new Blob([uint8Array], { type: 'video/mp4' });

// 创建下载链接
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'merged_video.mp4';
a.click();

// 清理内存
URL.revokeObjectURL(url);
```

## 5. 性能优化

### 5.1 前端性能优化

#### 5.1.1 内存管理
```javascript
class MemoryManager {
    constructor() {
        this.allocatedBuffers = new Set();
    }
    
    // 跟踪内存分配
    trackBuffer(buffer) {
        this.allocatedBuffers.add(buffer);
    }
    
    // 清理内存
    cleanup() {
        this.allocatedBuffers.forEach(buffer => {
            if (buffer && typeof buffer.delete === 'function') {
                buffer.delete();
            }
        });
        this.allocatedBuffers.clear();
        
        // 强制垃圾回收（如果支持）
        if (window.gc) {
            window.gc();
        }
    }
}
```

#### 5.1.2 异步处理优化
```javascript
// 使用 Web Workers 进行大文件处理
class WorkerManager {
    constructor() {
        this.worker = null;
    }
    
    async processLargeFile(file) {
        return new Promise((resolve, reject) => {
            this.worker = new Worker('file-processor.js');
            
            this.worker.postMessage({ file });
            
            this.worker.onmessage = event => {
                resolve(event.data);
                this.worker.terminate();
            };
            
            this.worker.onerror = error => {
                reject(error);
                this.worker.terminate();
            };
        });
    }
}
```

#### 5.1.3 缓存策略
```javascript
class CacheManager {
    constructor() {
        this.ffmpegCache = null;
    }
    
    // 缓存 FFmpeg 实例
    async getFFmpegInstance() {
        if (!this.ffmpegCache) {
            this.ffmpegCache = createFFmpeg({ log: true });
            await this.ffmpegCache.load();
        }
        return this.ffmpegCache;
    }
    
    // 清理缓存
    clearCache() {
        this.ffmpegCache = null;
    }
}
```

### 5.2 网络性能优化

#### 5.2.1 资源加载优化
```html
<!-- 预加载关键资源 -->
<link rel="preload" href="https://unpkg.com/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js" as="script">
<link rel="preload" href="https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js" as="script">

<!-- 使用 CDN 加速 -->
<script src="https://unpkg.com/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js"></script>
```

#### 5.2.2 HTTP 缓存配置
```javascript
// 服务器端缓存配置
setCacheHeaders(res, filePath) {
    const ext = path.extname(filePath);
    
    if (ext === '.js' || ext === '.css') {
        // 静态资源长期缓存
        res.setHeader('Cache-Control', 'public, max-age=31536000');
    } else if (ext === '.html') {
        // HTML 文件短期缓存
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}
```

## 6. 安全设计

### 6.1 客户端安全

#### 6.1.1 文件验证
```javascript
class SecurityValidator {
    // 文件类型验证
    validateFileType(file, allowedTypes) {
        return allowedTypes.includes(file.type);
    }
    
    // 文件大小验证
    validateFileSize(file, maxSize = 500 * 1024 * 1024) { // 500MB
        return file.size <= maxSize;
    }
    
    // 文件名验证
    validateFileName(fileName) {
        const dangerousChars = /[<>:"/\\|?*]/;
        return !dangerousChars.test(fileName);
    }
    
    // 综合验证
    validateFile(file, type) {
        const typeMap = {
            video: ['video/mp4'],
            audio: ['audio/wav']
        };
        
        return this.validateFileType(file, typeMap[type]) &&
               this.validateFileSize(file) &&
               this.validateFileName(file.name);
    }
}
```

#### 6.1.2 内存安全
```javascript
class MemorySafetyManager {
    constructor() {
        this.maxMemoryUsage = 1024 * 1024 * 1024; // 1GB
    }
    
    // 检查内存使用情况
    checkMemoryUsage() {
        if (performance.memory) {
            const used = performance.memory.usedJSHeapSize;
            const limit = performance.memory.jsHeapSizeLimit;
            
            if (used > this.maxMemoryUsage) {
                throw new Error('内存使用超出限制');
            }
            
            return { used, limit, percentage: (used / limit) * 100 };
        }
        return null;
    }
    
    // 内存清理
    forceGarbageCollection() {
        if (window.gc) {
            window.gc();
        }
    }
}
```

### 6.2 服务器安全

#### 6.2.1 CORS 安全配置
```javascript
class CORSManager {
    constructor() {
        this.allowedOrigins = [
            'http://localhost:3000',
            'https://yourdomain.com'
        ];
    }
    
    setCORSHeaders(req, res) {
        const origin = req.headers.origin;
        
        if (this.allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
        }
        
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    }
}
```

## 7. 测试设计

### 7.1 单元测试

#### 7.1.1 文件处理测试
```javascript
describe('FileManager', () => {
    let fileManager;
    
    beforeEach(() => {
        fileManager = new FileManager();
    });
    
    test('should validate MP4 video files', () => {
        const mockFile = { type: 'video/mp4', size: 1000000 };
        expect(fileManager.validateFile(mockFile, 'video')).toBe(true);
    });
    
    test('should reject non-MP4 video files', () => {
        const mockFile = { type: 'video/avi', size: 1000000 };
        expect(fileManager.validateFile(mockFile, 'video')).toBe(false);
    });
    
    test('should validate WAV audio files', () => {
        const mockFile = { type: 'audio/wav', size: 1000000 };
        expect(fileManager.validateFile(mockFile, 'audio')).toBe(true);
    });
});
```

#### 7.1.2 FFmpeg 处理测试
```javascript
describe('FFmpegProcessor', () => {
    let processor;
    
    beforeEach(() => {
        processor = new FFmpegProcessor();
    });
    
    test('should initialize FFmpeg successfully', async () => {
        await processor.initialize();
        expect(processor.isLoaded).toBe(true);
    });
    
    test('should merge video and audio', async () => {
        const mockVideoData = new Uint8Array([1, 2, 3]);
        const mockAudioData = new Uint8Array([4, 5, 6]);
        
        const result = await processor.mergeVideoAudio(mockVideoData, mockAudioData);
        expect(result).toBeInstanceOf(Uint8Array);
    });
});
```

### 7.2 集成测试

#### 7.2.1 端到端测试
```javascript
describe('Video Audio Merger E2E', () => {
    test('complete merge workflow', async () => {
        // 1. 加载页面
        await page.goto('http://localhost:3000');
        
        // 2. 选择视频文件
        const videoInput = await page.$('#videoFile');
        await videoInput.uploadFile('test-video.mp4');
        
        // 3. 选择音频文件
        const audioInput = await page.$('#audioFile');
        await audioInput.uploadFile('test-audio.wav');
        
        // 4. 点击合成按钮
        await page.click('#mergeBtn');
        
        // 5. 等待处理完成
        await page.waitForSelector('#status:contains("成功合成")', { timeout: 60000 });
        
        // 6. 验证下载
        const downloadPromise = page.waitForEvent('download');
        const download = await downloadPromise;
        expect(download.suggestedFilename()).toBe('merged_video.mp4');
    });
});
```

### 7.3 性能测试

#### 7.3.1 内存使用测试
```javascript
describe('Memory Usage', () => {
    test('should not exceed memory limit', async () => {
        const initialMemory = performance.memory.usedJSHeapSize;
        
        // 执行大文件处理
        await processLargeFile();
        
        const finalMemory = performance.memory.usedJSHeapSize;
        const memoryIncrease = finalMemory - initialMemory;
        
        expect(memoryIncrease).toBeLessThan(1024 * 1024 * 1024); // 1GB
    });
});
```

#### 7.3.2 处理速度测试
```javascript
describe('Processing Speed', () => {
    test('should process 100MB file within 5 minutes', async () => {
        const startTime = Date.now();
        
        await processFile('100mb-test-file.mp4');
        
        const endTime = Date.now();
        const processingTime = endTime - startTime;
        
        expect(processingTime).toBeLessThan(5 * 60 * 1000); // 5 minutes
    });
});
```

## 8. 部署设计

### 8.1 开发环境部署
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 运行测试
npm test

# 代码检查
npm run lint
```

### 8.2 生产环境部署

#### 8.2.1 静态网站部署
```yaml
# GitHub Actions 部署配置
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    
    - name: Setup Node.js
      uses: actions/setup-node@v2
      with:
        node-version: '16'
    
    - name: Install dependencies
      run: npm install
    
    - name: Build
      run: npm run build
    
    - name: Deploy
      uses: peaceiris/actions-gh-pages@v3
      with:
        github_token: ${{ secrets.GITHUB_TOKEN }}
        publish_dir: ./dist
```

#### 8.2.2 Docker 部署
```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

### 8.3 CDN 配置
```javascript
// CDN 资源配置
const CDN_CONFIG = {
    ffmpeg: 'https://unpkg.com/@ffmpeg/ffmpeg@0.11.0/dist/ffmpeg.min.js',
    core: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
    fallback: {
        ffmpeg: '/lib/ffmpeg.min.js',
        core: '/lib/ffmpeg-core.js'
    }
};
```

## 9. 监控和日志

### 9.1 错误监控
```javascript
class ErrorMonitor {
    constructor() {
        this.errors = [];
        this.setupGlobalErrorHandler();
    }
    
    setupGlobalErrorHandler() {
        window.addEventListener('error', event => {
            this.logError({
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                error: event.error
            });
        });
        
        window.addEventListener('unhandledrejection', event => {
            this.logError({
                message: 'Unhandled Promise Rejection',
                reason: event.reason
            });
        });
    }
    
    logError(error) {
        const errorInfo = {
            ...error,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        this.errors.push(errorInfo);
        console.error('Error logged:', errorInfo);
        
        // 发送到监控服务（如果需要）
        this.sendToMonitoring(errorInfo);
    }
}
```

### 9.2 性能监控
```javascript
class PerformanceMonitor {
    constructor() {
        this.metrics = {};
    }
    
    startTiming(name) {
        this.metrics[name] = { start: performance.now() };
    }
    
    endTiming(name) {
        if (this.metrics[name]) {
            this.metrics[name].end = performance.now();
            this.metrics[name].duration = this.metrics[name].end - this.metrics[name].start;
        }
    }
    
    getMetrics() {
        return this.metrics;
    }
    
    logPerformance() {
        console.table(this.metrics);
    }
}
```

## 10. 维护和扩展

### 10.1 代码维护
- 定期更新 FFmpeg.js 版本
- 监控浏览器兼容性变化
- 优化性能瓶颈
- 修复用户反馈的问题

### 10.2 功能扩展
- 支持更多音视频格式
- 添加音视频预览功能
- 实现批量处理
- 添加高级编辑功能

### 10.3 技术债务管理
- 重构复杂的代码模块
- 改进错误处理机制
- 优化内存使用
- 提升代码测试覆盖率

---

**文档版本**：v1.0  
**创建日期**：2025年11月  
**负责人**：技术团队  
**审核状态**：已审核