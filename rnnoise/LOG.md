噪音检测流程：
  
  > 主要是根据jitsi 会议流程处理，并对wave中噪音检测进行了新的改进且保持和jitsi一致
  
  > 前提条件：
     添加当前需要检测的音频流,根据`_StreamAdded`接口开始处理噪音检测流程；此接口主要是创建音频监听事件来触发接下来的逻辑处理
  
  1. 首先是根据当前状态是否静音
      - 如若静音，则不处理噪音检测流程；即暂时停止噪音检测逻辑，对应函数为`trackMuteChanged `;
      - 如若非静音，则处理噪音检测流程；函数为 `setupNewTrack`;
  2. 在` 非静音`模式下，处理流程大致如下：
      -  根据 `onAudioProcess` 函数 获取音频事件处理相关逻辑，从而对音频数据进行处理，处理噪音检测逻辑主要是根据`processVADScore`函数来执行；
      -  在不切换设备的前提下，当前线路检测到噪音则不会继续检测；否则直到检测到噪音为止
      
