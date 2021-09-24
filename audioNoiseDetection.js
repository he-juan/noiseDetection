"use strict";

let __spreadArray = (this && this.__spreadArray) || function (to, from) {
    for (var i = 0, il = from.length, j = to.length; i < il; i++, j++)
        to[j] = from[i];
    return to;
};

// 参考 https://github.com/jitsi/lib-jitsi-meet.git    https://github.com/jitsi/rnnoise-wasm.git    https://github.com/jitsi/jitsi-meet.git
// (function () {
//     setTimeout(requireMicrophone, 1000);
// }());


/**
 * load wasm
 * Creates a new instance of RnnoiseProcessor.
 */

function NoiseDetection (){
    this.rnnoiseContext = null;            // Rnnoise context object needed to perform the audio processing.
    this.wasmPcmInput = null;              // WASM dynamic memory buffer used as input for rnnoise processing method.
    this.wasmPcmOutput = null;             // WASM dynamic memory buffer used as output for rnnoise processing method.
    this.rnnoiseProcessor = null;          // WASM interface through which calls to rnnoise are made.
    this.wasmPcmInputF32Index = null;      // The Float32Array index representing the start point in the wasm heap of the _wasmPcmInput buffer.

    this.scriptProcessor = null
    this.mediaStreamSource = null
    this.AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    this.audioContext = null
    this.processing = false ;
    this.scoreArray = [];
    this.audioLvlArray = [];
    this.processTimeout = null;

    /**
     *  lib-jitsi-meet/modules/detection/VADNoiseDetection.js
     *  Constant. Rnnoise only takes operates on 44.1Khz float 32 little endian PCM.
     */
    this.pcmFrequency = 18000;
    this.rnnoiseSampleLength = 480 ;                           // Constant. Rnnoise default sample size, samples of different size won't work.
    this.vadEmitterSampleRate = 4096;                          // Sample rate of TrackVADEmitter, it defines how many audio samples are processed at a time.
    this.rnnoiseBufferSize = this.rnnoiseSampleLength * 4;     // Constant. Rnnoise only takes inputs of 480 PCM float32 samples thus 480*4.

    this.vadScoreTrigger = 0.2;                           // The value that a VAD score needs to be under in order for processing to begin. ? 没复制错
    this.audioLevelScoreTrigger = 0.020;                  // The value that a VAD score needs to be under in order for processing to begin. ? 一样的注释
    this.vadNoiseAvgThreshold = 0.2;                      // The average value VAD needs to be under over a period of time to be considered noise.
    this.noisyAudioLevelThreshold = 0.040;                // The average values that audio input need to be over to be considered loud.
    this.processTimeFrameSpanMs = 1500;
    this.rnnoiseModule = new rnnoiseWasmInit()
    if(this.rnnoiseModule){
        this.wasmHandle(this.rnnoiseModule)
    }
}

NoiseDetection.prototype.wasmHandle = async function(rnnoiseModule){
    let This = this
    This.rnnoiseProcessor = await rnnoiseModule;
    This.wasmPcmInput = This.rnnoiseProcessor._malloc(This.rnnoiseBufferSize);
    This.wasmPcmOutput = This.rnnoiseProcessor._malloc(This.rnnoiseBufferSize);
    This.rnnoiseContext = This.rnnoiseProcessor._rnnoise_create();
    This.wasmPcmInputF32Index = This.wasmPcmInput / 4;
    if (!This.wasmPcmInput) {
        log("Failed to create wasm input memory buffer!");
    }
    if (!This.wasmPcmOutput) {
        log("Failed to create wasm output memory buffer!");
    }
    console.warn("This.rnnoiseProcessor:",This.rnnoiseProcessor)
    console.warn("This.wasmPcmInput:",This.wasmPcmInput)
    console.warn("This.wasmPcmOutput:",This.wasmPcmOutput)
    console.warn("This.wasmPcmInputF32Index:",This.wasmPcmInputF32Index)
}


NoiseDetection.prototype.listenMicrophone = function(stream) {
    console.warn("开始检测噪音")
    log("开始检测噪音")
    let This = window.noiseDetection;

    let bufferResidue = new Float32Array([]);
    // This.audioContext = new  This.AudioContextImpl({sampleRate: This.pcmFrequency});
    This.audioContext = new  This.AudioContextImpl();
    This.mediaStreamSource = This.audioContext.createMediaStreamSource(stream);
    console.warn("This.audioContext:",This.audioContext)
    This.scriptProcessor = This.audioContext.createScriptProcessor(This.vadEmitterSampleRate, 1, 1);
    This.mediaStreamSource.connect(This.scriptProcessor);
    This.scriptProcessor.connect(This.audioContext.destination);
    This.scriptProcessor.addEventListener("audioprocess", function (audioEvent) {
        let inData = audioEvent.inputBuffer.getChannelData(0);
        // @ts-ignore
        let completeInData = __spreadArray(__spreadArray([], bufferResidue), inData);
        let i = 0;
        for ( ; i + This.rnnoiseSampleLength < completeInData.length; i += This.rnnoiseSampleLength) {
            let pcmSample = completeInData.slice(i, i + This.rnnoiseSampleLength);
            let vadScore = This.calculateAudioFrameVAD(pcmSample.slice());
            This.processVADScore(vadScore, pcmSample);
        }
        // @ts-ignore
        bufferResidue = completeInData.slice(i, completeInData.length);
    });
}

/**
 *  Calculate the Voice Activity Detection for a raw Float32 PCM sample Array.
 *   The size of the array must be of exactly 480 samples, this constraint comes from the rnnoise library.
 */
NoiseDetection.prototype.calculateAudioFrameVAD = function(pcmFrame) {
    let  This = window.noiseDetection;
    let pcmFrameLength = pcmFrame.length;
    if (pcmFrameLength !== This.rnnoiseSampleLength) {
        throw new Error("Rnnoise can only process PCM frames of 480 samples! Input sample was:" + pcmFrameLength);
    }
    This.convertTo16BitPCM(pcmFrame);
    This.copyPCMSampleToWasmBuffer(pcmFrame);
    return This.rnnoiseProcessor._rnnoise_process_frame(This.rnnoiseContext,This.wasmPcmOutput, This.wasmPcmInput);
}

/**
 * Convert 32 bit Float PCM samples to 16 bit Float PCM samples and store them in 32 bit Floats.
 */

NoiseDetection.prototype.convertTo16BitPCM = function(f32Array) {
    for (let _i = 0, _a = f32Array.entries(); _i < _a.length; _i++) {
        let _b = _a[_i], index = _b[0], value = _b[1];
        f32Array[index] = value * 0x7fff;
    }
}

/**
 * Copy the input PCM Audio Sample to the wasm input buffer.
 * @param pcmSample
 */
NoiseDetection.prototype.copyPCMSampleToWasmBuffer = function(pcmSample) {
    let  This = window.noiseDetection
    This.rnnoiseProcessor.HEAPF32.set(pcmSample,This.wasmPcmInputF32Index);
}

/**
 * // Returns only the positive values from an array of numbers.
 * @param valueArray
 * @returns {*}
 */
NoiseDetection.prototype.filterPositiveValues = function(valueArray) {
    return valueArray.filter(function (value) { return value >= 0; });
}


/**
 * Calculates the average value of am Array of numbers.
 * @param valueArray
 * @returns {number}
 */
NoiseDetection.prototype.calculateAverage = function(valueArray) {
    let avg =  valueArray.length > 0 ? valueArray.reduce(function (a, b) { return a + b; }) / valueArray.length : 0;
    return avg
}

NoiseDetection.prototype.reset = function() {
    let  This = window.noiseDetection;
    This.processing = false;
    This.processing = false;
    This.scoreArray = This.audioLvlArray = [];
    clearTimeout(This.processTimeout);
}

/**
 * Record the vad score and average volume in the appropriate buffers.
 * @param vadScore
 * @param avgAudioLvl
 */
NoiseDetection.prototype.recordValues = function(vadScore, avgAudioLvl) {
    let  This = window.noiseDetection;
    This.scoreArray.push(vadScore);
    This.audioLvlArray.push(avgAudioLvl);
}

/**
 * Compute cumulative VAD score and PCM audio levels once the PROCESS_TIME_FRAME_SPAN_MS timeout has elapsed.
 * If the score is above the set threshold fire the event.
 */
NoiseDetection.prototype.calculateNoisyScore = function() {
    let  This = window.noiseDetection
    let audioLevelAvg = This.calculateAverage(This.audioLvlArray);
    let scoreAvg = This.calculateAverage(This.scoreArray);
    if (scoreAvg < This.vadNoiseAvgThreshold && audioLevelAvg > This.noisyAudioLevelThreshold) {
        log("请注意，已经存在噪音");
    }
    This.reset();
    console.log("scoreAvg分数:", scoreAvg + 'audio平均分数：' + audioLevelAvg);
}
NoiseDetection.prototype.processVADScore = function(score, pcmData) {
    let  This = window.noiseDetection
    let posAudioLevels = This.filterPositiveValues(pcmData);
    let avgAudioLvl = This.calculateAverage(posAudioLevels);
    if (This.processing) {
        return;
    }

    /* If the VAD score for the sample is low and audio level has a high enough level we can start listening for noise */
    if (score < This.vadScoreTrigger) {
        if (avgAudioLvl > This.audioLevelScoreTrigger) {
            This.processing = true;
            This.recordValues(score, avgAudioLvl);
            // Once the preset timeout executes the final score will be calculated.
            // calculateNoisyScore();
            This.processTimeout = setTimeout(This.calculateNoisyScore(), This.processTimeFrameSpanMs);
        }
    }
}


NoiseDetection.prototype.stop = function(){
    let  This = window.noiseDetection
    This.wasmPcmInput = null;
    This.wasmPcmOutput = null;
    This.rnnoiseProcessor = null;
    This.wasmPcmInputF32Index = null;
    This.processing = false;
    This.AudioContextImpl = null;
    if(This.mediaStreamSource || This.scriptProcessor){
        This.mediaStreamSource.disconnect()
        This.scriptProcessor.disconnect()
        This.scriptProcessor = null;
        This.mediaStreamSource= null;
    }
    if(This.processTimeout){
        clearTimeout(This.processTimeout)
        This.processTimeout = null;
    }
    if(This.audioContext){
        This.audioContext.close()
        This.audioContext= null
    }
    This.rnnoiseContext= null
    This.rnnoiseModule = null
}


let audioStream
let option
let canvas = document.getElementById("canvas")
let start = document.getElementById("start")
let stop = document.getElementById("stop")
let audioInputSelect = document.querySelector('select#audioSource');
let param = {
    accuracy: 256,
    width: 1024,
    height: 200,
    waveform: {
        fadeSide: false,
        maxHeight: 200,
        verticalAlign: 'middle',
        horizontalAlign: 'center',
        color: '#2980b9'
    }
};


audioInputSelect.onchange = changeDeviced
start.onclick = requireMicrophone
stop.onclick = stopStream

function changeDeviced(){
    if(audioStream){
        stopStream()
    }
    let option = document.querySelector('select#audioSource').options
    option = option[option.selectedIndex]
    console.warn("audioInputSelect:",option)
}
function getDeviced(deviceInfos){
    console.warn("deviced:",deviceInfos)
    if(deviceInfos.length > 1){
        for(let i = 0; i !== deviceInfos.length; i++){
            let deviceInfo = deviceInfos[i]
            option = document.createElement('option')
            if (deviceInfo.kind === 'audioinput') {
                option.text = deviceInfo.label || `microphone ${audioInputSelect.length + 1}`;
                audioInputSelect.appendChild(option);
                console.warn("text:"+ option.text)
            } else if (deviceInfo.kind === 'audiooutput') {
                // option.text = deviceInfo.label || `speaker ${audioOutputSelect.length + 1}`;
                // audioOutputSelect.appendChild(option);
            } else {
                console.log('Some other kind of source/device: ', deviceInfo);
            }
            option.value = deviceInfo.deviceId
        }
    }
}

function requireMicrophone() {
    // 开始读取麦克风
    stop.disabled = false
    let option = document.querySelector('select#audioSource').options
    log("设备为：" + option[option.selectedIndex].text)
    console.log("设备为：" + option[option.selectedIndex].text)

    navigator.mediaDevices.getUserMedia({ audio: audioInputSelect.value, video: false })
        .then(function (stream) {
            audioStream = stream
            log("开始读取麦克风...");
            setTimeout(window.noiseDetection.listenMicrophone, 500, stream);

            // 开源图形化, 无噪音检测
            log("开始绘制频谱...")
            let vudio = new Vudio(stream,canvas,param)
            vudio.dance()
        }).catch(function(err){
        console.warn("麦克风读取失败：",err)
    })
}

function stopStream(){
    try {
        stop.disabled = true
        window.noiseDetection.stop()
        document.querySelector('textarea').value = null
        let tracks = audioStream.getTracks()
        for (let track in tracks) {
            tracks[track].onended = null
            console.log('close stream')
            tracks[track].stop()
        }
    } catch (e) {
        console.error(e)
    }
}

function log(value){
    document.querySelector('textarea').value += value + '\n'
}

window.addEventListener('load', function () {
    log('window onload!')
    navigator.mediaDevices.enumerateDevices().then(getDeviced).catch(function(err){console.warn("获取不到设备："+ err.message)})
    if(!window.noiseDetection){
        log('init...')
        window.noiseDetection = new NoiseDetection()
    }
})