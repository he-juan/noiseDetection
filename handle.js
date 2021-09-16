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
(function () {
    window.addEventListener("load", function (e) {
        // @ts-ignore
        var rnnoiseModule = rnnoiseWasmInit();
        rnnoiseModule.then(function (mod) {
            rnnoiseProcessor = mod;
            wasmPcmInput = rnnoiseProcessor._malloc(rnnoiseBufferSize);
            wasmPcmOutput = rnnoiseProcessor._malloc(rnnoiseBufferSize);
            context = rnnoiseProcessor._rnnoise_create();
            wasmPcmInputF32Index = wasmPcmInput / 4;
            // console.log(rnnoiseModule);
            console.log("获取文件:", rnnoiseProcessor);
            console.warn("wasmPcmInput:",wasmPcmInput)
            console.warn("wasmPcmOutput:",wasmPcmOutput)
            console.warn("context:",context)
            if (!wasmPcmInput) {
                console.log("Failed to create wasm input memory buffer!");
            }
            if (!wasmPcmOutput) {
                console.log("Failed to create wasm output memory buffer!");
            }
        });
    });
}());

let context;                   // Rnnoise context object needed to perform the audio processing.
let wasmPcmInput;              // WASM dynamic memory buffer used as input for rnnoise processing method.
let wasmPcmOutput;             // WASM dynamic memory buffer used as output for rnnoise processing method.
let rnnoiseProcessor;          // WASM interface through which calls to rnnoise are made.
let wasmPcmInputF32Index;      // The Float32Array index representing the start point in the wasm heap of the _wasmPcmInput buffer.

let processing;
let scoreArray = [];
let audioLvlArray = [];
let processTimeout;

let audioStream
let canvas = document.getElementById("canvas")
let start = document.getElementById("start")
let stop = document.getElementById("stop")
let audioInputSelect = document.querySelector('select#audioSource');
let audioOutputSelect = document.querySelector('select#audioOutput');
// let selectors = [audioInputSelect, audioOutputSelect]
audioInputSelect.onchange = getDeviced
start.onclick = requireMicrophone
stop.onclick = stopStream

navigator.mediaDevices.enumerateDevices().then(getDeviced).catch(function(err){console.warn("获取不到设备："+ err.message)})

function getDeviced(deviceInfos){
    console.warn("deviced:",deviceInfos)
    for(let i = 0; i !== deviceInfos.length; i++){
        let deviceInfo = deviceInfos[i]
        let option = document.createElement('option')
        option.value = deviceInfo.deviceId

        if (deviceInfo.kind === 'audioinput') {
            option.text = deviceInfo.label || `microphone ${audioInputSelect.length + 1}`;
            audioInputSelect.appendChild(option);
            console.warn("text:"+option.text)
        } else if (deviceInfo.kind === 'audiooutput') {
            // option.text = deviceInfo.label || `speaker ${audioOutputSelect.length + 1}`;
            // audioOutputSelect.appendChild(option);
        } else {
            console.log('Some other kind of source/device: ', deviceInfo);
        }
    }
}

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
}


/**
 *  lib-jitsi-meet/modules/detection/VADNoiseDetection.js
 *  Constant. Rnnoise only takes operates on 44.1Khz float 32 little endian PCM.
 */
// const PCM_FREQUENCY: number = 44100;
let PCM_FREQUENCY = 18000;                           // 18K ?
let rnnoiseSampleLength = 480 ;                      // Constant. Rnnoise default sample size, samples of different size won't work.
let vadEmitterSampleRate = 4096;                     // Sample rate of TrackVADEmitter, it defines how many audio samples are processed at a time.
let rnnoiseBufferSize = rnnoiseSampleLength * 4;     // Constant. Rnnoise only takes inputs of 480 PCM float32 samples thus 480*4.

let vadScoreTrigger = 0.2;                           // The value that a VAD score needs to be under in order for processing to begin. ? 没复制错
let audioLevelScoreTrigger = 0.020;                  // The value that a VAD score needs to be under in order for processing to begin. ? 一样的注释
let vadNoiseAvgThreshold = 0.2;                      // The average value VAD needs to be under over a period of time to be considered noise.
let noisyAudioLevelThreshold = 0.040;                // The average values that audio input need to be over to be considered loud.
let processTimeFrameSpanMs = 1500

function requireMicrophone() {
    // 开始读取麦克风
    stop.disabled = false
    console.warn("constraints:",audioInputSelect.value)
    navigator.mediaDevices.getUserMedia({ audio: audioInputSelect.value, video: false })
        .then(function (stream) {
            audioStream = stream
            log("开始读取麦克风...");
            setTimeout(listenMicrophone, 500, stream);

             // 开源图形化, 无噪音检测
            let vudio = new Vudio(stream,canvas,param)
            vudio.dance()
    }).catch(function(err){
        console.warn("麦克风读取失败：",err)
    })
}

function listenMicrophone(stream) {
    let mediaStreamSource;
    let bufferResidue = new Float32Array([]);
    let scriptProcessor;
    let AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    let audioContext = new AudioContextImpl({sampleRate: PCM_FREQUENCY});   // ? 指定参数 Firefox 报错
    // let audioContext = new AudioContextImpl({});
    mediaStreamSource = audioContext.createMediaStreamSource(stream);
    scriptProcessor = audioContext.createScriptProcessor(vadEmitterSampleRate, 1, 1);
    mediaStreamSource.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);
    scriptProcessor.addEventListener("audioprocess", function (audioEvent) {
        let inData = audioEvent.inputBuffer.getChannelData(0);
        // @ts-ignore
        let completeInData = __spreadArray(__spreadArray([], bufferResidue), inData);
        let i = 0;
        for ( ; i + rnnoiseSampleLength < completeInData.length; i += rnnoiseSampleLength) {
            let pcmSample = completeInData.slice(i, i + rnnoiseSampleLength);
            let vadScore = calculateAudioFrameVAD(pcmSample.slice());
            if(vadScore != 0){
                console.log("audioprocess score:", vadScore);
            }
            processVADScore(vadScore, pcmSample);
        }
        // @ts-ignore
        bufferResidue = completeInData.slice(i, completeInData.length);
    });
   log("麦克风连接成功");
}

 /**
  *  Calculate the Voice Activity Detection for a raw Float32 PCM sample Array.
  *   The size of the array must be of exactly 480 samples, this constraint comes from the rnnoise library.
  */
function calculateAudioFrameVAD(pcmFrame) {
    var pcmFrameLength = pcmFrame.length;
    if (pcmFrameLength !== rnnoiseSampleLength) {
        throw new Error("Rnnoise can only process PCM frames of 480 samples! Input sample was:" + pcmFrameLength);
    }
    convertTo16BitPCM(pcmFrame);
    copyPCMSampleToWasmBuffer(pcmFrame);
    return rnnoiseProcessor._rnnoise_process_frame(context, wasmPcmOutput, wasmPcmInput);
}

/**
 * Convert 32 bit Float PCM samples to 16 bit Float PCM samples and store them in 32 bit Floats.
 */

function convertTo16BitPCM(f32Array) {
    for (var _i = 0, _a = f32Array.entries(); _i < _a.length; _i++) {
        var _b = _a[_i], index = _b[0], value = _b[1];
        f32Array[index] = value * 0x7fff;
    }
}

/**
 * Copy the input PCM Audio Sample to the wasm input buffer.
 * @param pcmSample
 */
function copyPCMSampleToWasmBuffer(pcmSample) {
    rnnoiseProcessor.HEAPF32.set(pcmSample, wasmPcmInputF32Index);
}

/**
 * // Returns only the positive values from an array of numbers.
 * @param valueArray
 * @returns {*}
 */
function filterPositiveValues(valueArray) {
    return valueArray.filter(function (value) { return value >= 0; });
}


/**
 * Calculates the average value of am Array of numbers.
 * @param valueArray
 * @returns {number}
 */
function calculateAverage(valueArray) {
    return valueArray.length > 0 ? valueArray.reduce(function (a, b) { return a + b; }) / valueArray.length : 0;
}

function reset() {
    processing = false;
    scoreArray = audioLvlArray = [];
    clearTimeout(processTimeout);
}

/**
 * Record the vad score and average volume in the appropriate buffers.
 * @param vadScore
 * @param avgAudioLvl
 */
function recordValues(vadScore, avgAudioLvl) {
    scoreArray.push(vadScore);
    audioLvlArray.push(avgAudioLvl);
}

/**
 * Compute cumulative VAD score and PCM audio levels once the PROCESS_TIME_FRAME_SPAN_MS timeout has elapsed.
 * If the score is above the set threshold fire the event.
 */
function calculateNoisyScore() {
    let scoreAvg = calculateAverage(scoreArray);
    let audioLevelAvg = calculateAverage(audioLvlArray);
    if (scoreAvg < vadNoiseAvgThreshold && audioLevelAvg > noisyAudioLevelThreshold) {
        log("scoreAvg:" + scoreAvg)
        log("audioLevelAvg:" + audioLevelAvg)
        console.warn("请注意，已经存在噪音");
        log("请注意，已经存在噪音")
    }
    reset();
    console.log("分数:" +  scoreAvg, audioLevelAvg);
}
function processVADScore(score, pcmData) {
    let posAudioLevels = filterPositiveValues(pcmData);
    let avgAudioLvl = calculateAverage(posAudioLevels);
    if (processing) {
        return;
    }
    /* If the VAD score for the sample is low and audio level has a high enough level we can start listening for noise */
    if (score < vadScoreTrigger) {
        if (avgAudioLvl > audioLevelScoreTrigger) {
            processing = true;
            recordValues(score, avgAudioLvl);
            // Once the preset timeout executes the final score will be calculated.
            // calculateNoisyScore();
            processTimeout = setTimeout(calculateNoisyScore, processTimeFrameSpanMs);
        }
    }
}


function stopStream(){
    try {
        stop.disabled = true
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