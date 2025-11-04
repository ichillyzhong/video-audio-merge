// app.js

// 使用FFmpeg.js 0.11.0版本 - 确保版本兼容
const { createFFmpeg, fetchFile } = FFmpeg;

const ffmpeg = createFFmpeg({
    log: true,
    // 让FFmpeg.js自动选择兼容的core版本
});

// --- DOM 元素和变量 ---
const videoFileInput = document.getElementById('videoFile');
const audioFileInput = document.getElementById('audioFile');
const mergeBtn = document.getElementById('mergeBtn');
const statusDiv = document.getElementById('status');

let videoFile = null;
let audioFile = null;

// --- 状态检查和按钮启用 ---
function checkReady() {
    // 检查两个文件是否都已选择
    if (videoFile && audioFile) {
        mergeBtn.disabled = false;
        statusDiv.textContent = '文件加载完成，可以开始合成。';
    } else {
        mergeBtn.disabled = true;
        statusDiv.textContent = '请上传 MP4 视频和 WAV 音频文件。';
    }
}

videoFileInput.addEventListener('change', (e) => {
    videoFile = e.target.files[0];
    checkReady();
});

audioFileInput.addEventListener('change', (e) => {
    audioFile = e.target.files[0];
    checkReady();
});


// --- 核心处理函数 ---
mergeBtn.addEventListener('click', async () => {
    if (!videoFile || !audioFile) return;

    mergeBtn.disabled = true;
    statusDiv.textContent = '正在初始化 FFmpeg... (首次启动较慢)';

    // 1. 加载 FFmpeg 核心模块
    if (!ffmpeg.isLoaded()) {
        try {
            await ffmpeg.load();
            statusDiv.textContent = 'FFmpeg 加载完成！';
        } catch (error) {
            statusDiv.textContent = 'FFmpeg 加载失败，请检查网络。';
            mergeBtn.disabled = false;
            console.error(error);
            return;
        }
    }

    const videoFileName = 'input_video.mp4';
    const audioFileName = 'input_audio.wav';
    const outputFileName = 'merged_video.mp4';

    statusDiv.textContent = '将文件写入虚拟文件系统 (VFS)...';

    try {
        // 2. 将文件写入 FFmpeg 虚拟文件系统 (VFS)
        ffmpeg.FS('writeFile', videoFileName, await fetchFile(videoFile));
        ffmpeg.FS('writeFile', audioFileName, await fetchFile(audioFile));

        statusDiv.textContent = '开始执行 FFmpeg 合成命令...';

        // 3. 执行 FFmpeg 合成命令
        await ffmpeg.run(
            // 输入文件 1: 无声视频
            '-i', videoFileName, 
            // 输入文件 2: WAV 音频
            '-i', audioFileName, 
            
            // 视频设置: 复制视频流 (无需重新编码，速度快)
            '-c:v', 'copy', 
            // 音频设置: 将 WAV 重新编码为 AAC (MP4 标准格式)
            // WAV (PCM) 通常不能直接复制到 MP4 容器
            '-c:a', 'aac', 
            
            // 映射：选择第一个输入的视频流 (0:v:0)
            '-map', '0:v:0', 
            // 映射：选择第二个输入的音频流 (1:a:0)
            '-map', '1:a:0', 
            
            // 保证输出时长与最短的输入文件一致 (防止音频或视频无限循环)
            '-shortest', 
            
            // 输出文件名
            outputFileName
        );

        // 4. 从 VFS 读取并下载合成后的文件
        statusDiv.textContent = '合成完成，准备下载...';
        const data = ffmpeg.FS('readFile', outputFileName);

        const url = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
        
        const a = document.createElement('a');
        a.href = url;
        a.download = outputFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        statusDiv.textContent = `✅ 成功合成，文件已下载: ${outputFileName}`;
        
    } catch (error) {
        console.error('合成失败:', error);
        statusDiv.textContent = `合成失败: ${error.message}`;
    } finally {
        mergeBtn.disabled = false;
        // 清理 VFS 文件，释放内存（可选但推荐）
        try {
            ffmpeg.FS('unlink', videoFileName);
            ffmpeg.FS('unlink', audioFileName);
            ffmpeg.FS('unlink', outputFileName);
        } catch (e) {
            // 忽略删除文件的错误
        }
    }
});