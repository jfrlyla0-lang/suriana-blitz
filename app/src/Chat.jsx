import React, { useState, useEffect, useRef } from 'react';

export function ChatView({ userPoints, setUserPoints, form, initialChat }) {
  const connectCallSocket = () => {
    if (callSocketRef.current && callSocketRef.current.readyState === WebSocket.OPEN) {
      return callSocketRef.current;
    }

    const socket = new WebSocket(
      (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/"
    );

    callSocketRef.current = socket;
    return socket;
  };

  const sendCallSignal = (type, callId, targetUserId, data) => {
    const socket = callSocketRef.current;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("CALL SOCKET NOT READY");
      return false;
    }

    socket.send(JSON.stringify({
      type,
      call_id: Number(callId),
      target_user_id: Number(targetUserId),
      data: data ?? null
    }));

    return true;
  };

  const createPeerConnection = async (callId, targetUserId, isCaller) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }

    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    });

    peerConnectionRef.current = peer;

    if (!localStreamRef.current) {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
    }

    localStreamRef.current.getTracks().forEach(track => {
      peer.addTrack(track, localStreamRef.current);
    });

    peer.ontrack = (event) => {
      if (!remoteAudioRef.current) return;

      const [stream] = event.streams;
      if (stream) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(() => {});
      }
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;

      sendCallSignal(
        "ice-candidate",
        callId,
        targetUserId,
        event.candidate
      );
    };

    peer.onconnectionstatechange = () => {
      console.log("WEBRTC CONNECTION:", peer.connectionState);
    };

    if (isCaller) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      sendCallSignal(
        "offer",
        callId,
        targetUserId,
        peer.localDescription
      );
    }

    return peer;
  };

  useEffect(()=>{
  },[]);
  const [activeChat, setActiveChat] = useState(initialChat || null);

    useEffect(() => {
      if(initialChat){
        setActiveChat(initialChat);
      }
    }, [initialChat]);
  const [input, setInput] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const messageInputRef = useRef(null);
  const [showGiftBox, setShowGiftBox] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  useEffect(() => {
    const checkBlock = async () => {
      if(!activeChat?.id) return;
      try {
        const r=await fetch("/api/blocks/"+Number(activeChat.id),{
        credentials:"include"
        });
        const d=await r.json();
        if(r.ok && d.success) setIsBlocked(Boolean(d.blocked));
      }catch(e){
        console.error("BLOCK STATUS ERROR:",e);
      }
    };
    checkBlock();
    setShowMoreMenu(false);
  }, [activeChat]);

  const toggleBlock = async () => {
    if(!activeChat?.id) return;

    const action=isBlocked ? "فك حظر" : "حظر";
    if(!window.confirm("هل تريد "+action+" هذا المستخدم؟")) return;

    try{
      const url="/api/blocks/"+Number(activeChat.id);
      const r=await fetch(url,{
        method:isBlocked ? "DELETE" : "POST",
        credentials:"include"
      });
      const d=await r.json();

      if(!r.ok || !d.success){
        alert(d.message || "تعذر تنفيذ العملية");
        return;
      }

      setIsBlocked(!isBlocked);
      setShowMoreMenu(false);
    }catch(e){
      console.error("BLOCK ACTION ERROR:",e);
      alert("تعذر تنفيذ العملية");
    }
  };

  const reportUser = async () => {
    if(!activeChat?.id) return;

    const reason=window.prompt(
      "سبب البلاغ؟\nمثال: إساءة، احتيال، محتوى مخالف",
      ""
    );

    if(!reason || !reason.trim()) return;

    const details=window.prompt("تفاصيل إضافية (اختياري):","");

    try{
      const r=await fetch("/api/reports",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
        },
        credentials:"include",
        body:JSON.stringify({
          target_user_id:Number(activeChat.id),
          reason:reason.trim(),
          details:details ? details.trim() : ""
        })
      });

      const d=await r.json();

      if(!r.ok || !d.success){
        alert(d.message || "تعذر إرسال البلاغ");
        return;
      }

      setShowMoreMenu(false);
      alert("تم إرسال البلاغ بنجاح 🚩");
    }catch(e){
      console.error("REPORT USER ERROR:",e);
      alert("تعذر إرسال البلاغ");
    }
  };

  
  const imageInputRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const [showChatAttachMenu, setShowChatAttachMenu] = useState(false);
  const audioChunksRef = useRef([]);
  const [isSendingMedia, setIsSendingMedia] = useState(false);
  const [isRecordingAudio, setIsRecordingAudio] = useState(false);

  const handleImageSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";

    if (!file || !activeChat?.id || isSendingMedia) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      alert("صيغة الصورة غير مدعومة");
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      alert("حجم الصورة يجب ألا يتجاوز 8MB");
      return;
    }

    try {
      setIsSendingMedia(true);

      const media = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch("/api/messages/media", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          receiver_id: Number(activeChat.id),
          message_type: "image",
          media
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(data.message || "تعذر إرسال الصورة");
        return;
      }

      if (data.remaining_points !== undefined) {
        setUserPoints(Number(data.remaining_points));
      }

      await loadRealMessages();
    } catch (err) {
      console.error("SEND IMAGE ERROR:", err);
      alert("تعذر إرسال الصورة");
    } finally {
      setIsSendingMedia(false);
    }
  };

  const toggleAudioRecording = async () => {
    if (!activeChat?.id || isSendingMedia) return;

    if (isRecordingAudio) {
      audioRecorderRef.current?.stop();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      alert("التسجيل الصوتي غير مدعوم");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "";

      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        mimeType = "audio/mp4";
      }

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      audioRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = e => {
        if (e.data?.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setIsRecordingAudio(false);
        setIsSendingMedia(true);

        try {
          const blobType = (recorder.mimeType || "audio/webm").split(";")[0];
          const blob = new Blob(audioChunksRef.current, { type: blobType });

          const media = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });



          const response = await fetch("/api/messages/media", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",

            },
            body: JSON.stringify({
              receiver_id: Number(activeChat.id),
              message_type: "audio",
              media
            })
          });

          const data = await response.json();

          if (!response.ok || !data.success) {
            alert(data.message || "تعذر إرسال التسجيل الصوتي");
            return;
          }

          if (data.remaining_points !== undefined) {
            setUserPoints(Number(data.remaining_points));
          }

          await loadRealMessages();
        } catch (err) {
          console.error("SEND AUDIO ERROR:", err);
          alert("تعذر إرسال التسجيل الصوتي");
        } finally {
          setIsSendingMedia(false);
          audioChunksRef.current = [];
          audioRecorderRef.current = null;
        }
      };

      recorder.start();
      setIsRecordingAudio(true);
    } catch (err) {
      console.error("AUDIO RECORD ERROR:", err);
      alert("تعذر الوصول إلى الميكروفون");
    }
  };

  const [activeCallId, setActiveCallId] = useState(null);
const [incomingCall, setIncomingCall] = useState(null);
const [callStatus, setCallStatus] = useState(null);
const [callStartedAt, setCallStartedAt] = useState(null);
const [showCallScreen, setShowCallScreen] = useState(false);
    const [inCall, setInCall] = useState(false);
    const [callSeconds, setCallSeconds] = useState(0);
    const [maxCallSeconds, setMaxCallSeconds] = useState(null);
  const [callPeerUserId, setCallPeerUserId] = useState(null);
  const [isCallInitiator, setIsCallInitiator] = useState(false);
    const endCallButtonRef = useRef(null);
  const callSocketRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);

      const callStartedAtRef = useRef(null);

  const cleanupWebRTC = () => {
    if (callSocketRef.current) {
      callSocketRef.current.close();
      callSocketRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    pendingIceCandidatesRef.current = [];

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!activeCallId || !callPeerUserId) return;

    const socket = connectCallSocket();
    if (!socket) return;

    const handleMessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (Number(message.call_id) !== Number(activeCallId)) return;

        if (message.type === "offer") {
          const peer = await createPeerConnection(
            activeCallId,
            callPeerUserId,
            false
          );

          await peer.setRemoteDescription(
            new RTCSessionDescription(message.data)
          );

          const pending = pendingIceCandidatesRef.current;
          pendingIceCandidatesRef.current = [];

          for (const candidate of pending) {
            try {
              await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.error("PENDING ICE ERROR:", error);
            }
          }

          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);

          sendCallSignal(
            "answer",
            activeCallId,
            callPeerUserId,
            peer.localDescription
          );
          return;
        }

        if (message.type === "answer") {
          const peer = peerConnectionRef.current;
          if (!peer) return;

          await peer.setRemoteDescription(
            new RTCSessionDescription(message.data)
          );

          const pending = pendingIceCandidatesRef.current;
          pendingIceCandidatesRef.current = [];

          for (const candidate of pending) {
            try {
              await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.error("PENDING ICE ERROR:", error);
            }
          }
          return;
        }

        if (message.type === "ice-candidate") {
          const candidate = message.data;
          const peer = peerConnectionRef.current;

          if (!candidate) return;

          if (peer && peer.remoteDescription) {
            try {
              await peer.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (error) {
              console.error("ICE CANDIDATE ERROR:", error);
            }
          } else {
            pendingIceCandidatesRef.current.push(candidate);
          }
        }
      } catch (error) {
        console.error("CALL SIGNAL ERROR:", error);
      }
    };

    const handleOpen = async () => {

      if (
        callStatus === "started" &&
        !peerConnectionRef.current &&
        isCallInitiator
      ){
        try {
          await createPeerConnection(
            activeCallId,
            callPeerUserId,
            true
          );
        } catch (error) {
          console.error("WEBRTC START ERROR:", error);
          alert("تعذر تشغيل الميكروفون");
        }
      }
    };

    socket.addEventListener("message", handleMessage);
    socket.addEventListener("open", handleOpen);

    if (socket.readyState === WebSocket.OPEN) {
      handleOpen();
    }

    return () => {
      socket.removeEventListener("message", handleMessage);
      socket.removeEventListener("open", handleOpen);
    };
  }, [activeCallId, callPeerUserId, callStatus, isCallInitiator]);

  useEffect(()=>{
  if(!activeCallId){
    callStartedAtRef.current = null;
    setCallStatus(null);
    setCallStartedAt(null);
    return;
  }

  let stopped = false;
  let timer = null;

  const syncCall = async ()=>{
    try{
      const response = await fetch(
        `${window.location.origin}/api/calls/${encodeURIComponent(activeCallId)}/status`,
        {
          signal: AbortSignal.timeout(5000),
          headers:{
          },
          credentials:"include"
        }
      );

      const data = await response.json();

      if(!response.ok || !data.success || !data.call){
        return;
      }

      if(stopped) return;

      const status = String(data.call.status || "");
      setCallStatus(status);

      if(status === "ringing"){
        setCallSeconds(0);
        setCallStartedAt(null);
        callStartedAtRef.current = null;
        return;
      }

        if(status === "started"){
          setShowCallScreen(true);
          setInCall(true);
        const serverStartedAt = data.call.started_at
          ? String(data.call.started_at)
          : null;

        if(serverStartedAt){
          const normalized = serverStartedAt.includes("T")
            ? serverStartedAt
            : serverStartedAt.replace(" ", "T") + "Z";

          const timestamp = new Date(normalized).getTime();

          if(Number.isFinite(timestamp)){
            setCallStartedAt(serverStartedAt);
            callStartedAtRef.current = timestamp;

            const elapsed = Math.max(
              0,
              Math.floor((Date.now() - timestamp) / 1000)
            );

            setCallSeconds(elapsed);

            const limit = Number(
              data.call.max_seconds ?? maxCallSeconds
            );

            if(
              Number.isFinite(limit) &&
              limit > 0 &&
              elapsed >= limit
            ){
              cleanupWebRTC();
              setCallPeerUserId(null);
              setShowCallScreen(false);
              setInCall(false);
              setActiveCallId(null);
              setMaxCallSeconds(null);
              return;
            }
          }
        }

        return;
      }

      if(
        status === "rejected" ||
        status === "cancelled" ||
        status === "ended"
      ){
        cleanupWebRTC();
        setCallPeerUserId(null);
        setShowCallScreen(false);
        setInCall(false);
        setActiveCallId(null);
        setMaxCallSeconds(null);
        setCallSeconds(0);
        setCallStartedAt(null);
        callStartedAtRef.current = null;

        if(status === "rejected"){
          alert("📞 تم رفض المكالمة");
        }else if(status === "cancelled"){
          alert("📞 تم إلغاء المكالمة");
        }

        return;
      }
    }catch(e){
      console.error("CALL STATUS SYNC ERROR:",e);
    }
  };

  syncCall();

  const poll = setInterval(syncCall, 1000);

  timer = setInterval(()=>{
    if(stopped) return;

    const startedAt = callStartedAtRef.current;

    if(!startedAt){
      setCallSeconds(0);
      return;
    }

    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - startedAt) / 1000)
    );

    setCallSeconds(elapsed);
  },250);

  return ()=>{
    stopped = true;
    clearInterval(poll);
    if(timer) clearInterval(timer);
  };
},[activeCallId,maxCallSeconds,setUserPoints]);

/* INCOMING_CALL_POLL */
useEffect(()=>{
  let stopped = false;

  const checkIncomingCall = async ()=>{
    try{
      const response = await fetch(
        window.location.origin + "/api/calls/incoming",
        {
          signal: AbortSignal.timeout(5000),
          headers:{
          },
          credentials:"include"
        }
      );

      const data = await response.json();

      if(stopped) return;

      if(
        response.ok &&
        data.success &&
        data.call &&
        String(data.call.status) === "ringing"
      ){
        setIncomingCall(data.call);
      }else{
        setIncomingCall(null);
      }
    }catch(e){
      if(!stopped){
        console.error("INCOMING CALL CHECK ERROR:",e);
      }
    }
  };

  checkIncomingCall();

  const poll = setInterval(checkIncomingCall,1000);

  return ()=>{
    stopped = true;
    clearInterval(poll);
  };
},[]);

const gifts = [
    {name:"🌹 وردة", points:10},
    {name:"💖 قلب", points:20},
    {name:"🍫 شوكولا", points:30},
    {name:"☕ قهوة", points:50},
    {name:"🍰 كيك", points:75},
    {name:"💎 ألماسة", points:100},
    {name:"🎁 صندوق مفاجأة", points:150},
    {name:"👑 تاج", points:200},
    {name:"🧸 دبدوب فاخر", points:300},
    {name:"💍 خاتم ماسي", points:500}
  ];
  const sendGift = async (gift)=>{
    if(!activeChat){
      alert("اختر المستخدم أولاً");
      return;
    }

    if(userPoints < gift.points){
      alert("🚨 نقاطك غير كافية");
      return;
    }

    try{
      const response = await fetch(window.location.origin + "/api/gifts",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
        },
        body:JSON.stringify({
          receiver_id:Number(activeChat.id),
          points:Number(gift.points)
        })
      });

      const data = await response.json();

      if(!response.ok || !data.success){
        alert(data?.message || "تعذر إرسال الهدية");
        return;
      }

      if(typeof data.remaining_points !== "undefined" &&
         data.remaining_points !== null &&
         setUserPoints){
        setUserPoints(Number(data.remaining_points));
      }



      setShowGiftBox(false);

      alert(
        `🎁 تم إرسال ${gift.name}\n\n`+
        `تم إرسال الهدية بنجاح ❤️`
      );

    }catch(e){
      console.error("GIFT ERROR:",e);
      alert("تعذر الاتصال بالسيرفر");
    }
  };
  const [realChatList, setRealChatList] = useState([]);
  const [chatListLoading, setChatListLoading] = useState(false);

  const loadRealChatList = async () => {

    if (!token) return;

    try {
      setChatListLoading(true);

      const response = await fetch("/api/messages/conversations", {
        headers: {
        },
        credentials:"include",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error("LOAD REAL CHAT LIST ERROR:", data);
        return;
      }

      const mapped = (data.conversations || []).map(chat => ({
        id: Number(chat.id),
        name: chat.name || ("مستخدم " + chat.id),
        img: chat.avatar || "",
        lastMsg: chat.lastMsg || "",
        time: formatMessageTime(chat.lastTime),
        unread: Number(chat.unread || 0),
        online: Boolean(chat.online),
        lastSeen: chat.last_seen || null,
        realChat: true
      }));

      setRealChatList(mapped);
    } catch (error) {
      console.error("LOAD REAL CHAT LIST ERROR:", error);
    } finally {
      setChatListLoading(false);
    }
  };

const [messages, setMessages] = useState([]);
  const messagesContainerRef = useRef(null);
  const [messagesLoading, setMessagesLoading] = useState(false);


  const [otherOnline, setOtherOnline] = useState(false);
  const [otherLastSeen, setOtherLastSeen] = useState(null);

  const formatMessageTime = (value) => {
    if (!value) return "الآن";

    const raw = String(value);
    const normalized = raw.includes("T") || raw.endsWith("Z")
      ? raw
      : raw.replace(" ", "T") + "Z";

    const d = new Date(normalized);

    if (Number.isNaN(d.getTime())) return "الآن";

    return d.toLocaleTimeString("ar-SY", {
      hour: "numeric",
      minute: "2-digit"
    });
  };

  const loadRealMessages = async () => {
    if (!activeChat || !activeChat.id) {
      setMessages([]);
      return;
    }


    if (!token) return;

    try {
      setMessagesLoading(true);

      const response = await fetch(
        `/api/messages/${Number(activeChat.id)}`,
        {
          headers: {
          },
          credentials:"include",
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        console.error("LOAD REAL MESSAGES ERROR:", data);
        return;
      }

      const mapped = (data.messages || []).map(msg => ({
        id: Number(msg.id),
        text: msg.content,
        messageType: msg.message_type || 'text',
        mediaUrl: msg.media_url
          ? (msg.media_url.startsWith('http')
              ? msg.media_url
              : window.location.origin + msg.media_url)
          : null,
        sender:
          Number(msg.sender_id) === Number(activeChat.id)
            ? "girl"
            : "user",
        time: formatMessageTime(msg.created_at),
        isDelivered: Number(msg.is_delivered) === 1,
        isRead: Number(msg.is_read) === 1,
        deliveredAt: msg.delivered_at,
        readAt: msg.read_at,
        realMessage: true
      }));

      const previousCount = messagesContainerRef.current?.dataset.messageCount
        ? Number(messagesContainerRef.current.dataset.messageCount)
        : 0;

      setMessages(mapped);

      requestAnimationFrame(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        const isNewMessage = mapped.length > previousCount;
        if (isNewMessage) {
          container.scrollTop = container.scrollHeight;
        }

        container.dataset.messageCount = String(mapped.length);
      });

      // أولاً: اعتبر الرسائل الواردة مُسلّمة
      try {
        await fetch(
          `/api/messages/${Number(activeChat.id)}/delivered`,
          {
            method: "POST",
            headers: {
            },
            credentials:"include",
          }
        );
      } catch (deliveryError) {
        console.log("MARK DELIVERED ERROR:", deliveryError);
      }

      // ثم: اعتبر الرسائل الواردة مقروءة على السيرفر
      try {
        await fetch(
          `/api/messages/${Number(activeChat.id)}/read`,
          {
            method: "POST",
            headers: {
            },
            credentials:"include",
          }
        );
      } catch (readError) {
        console.log("MARK READ ERROR:", readError);
      }

    } catch (error) {
      console.error("LOAD REAL MESSAGES ERROR:", error);
    } finally {
      setMessagesLoading(false);
    }
  };

  // CHAT_PRESENCE_FRONTEND_READY
  useEffect(() => {
    if (!activeChat?.id) {
      setOtherOnline(false);
      setOtherLastSeen(null);
      return;
    }


    if (!token) return;

    let cancelled = false;

    const loadPresence = async () => {
      try {
        const response = await fetch(
          `/api/presence/${Number(activeChat.id)}`,
          {
            headers: {
            },
            credentials:"include",
          }
        );

        const data = await response.json();

        if (!cancelled && response.ok && data.success) {
          setOtherOnline(Boolean(data.online));
          setOtherLastSeen(data.last_seen || null);
        }
      } catch (error) {
        console.log("PRESENCE ERROR:", error);
      }
    };

    const heartbeat = async () => {
      try {
        await fetch("/api/presence/heartbeat", {
          method: "POST",
          headers: {
          },
          credentials:"include",
        });
      } catch (error) {
        console.log("HEARTBEAT ERROR:", error);
      }
    };

    loadPresence();
    heartbeat();

    const timer = setInterval(() => {
      loadPresence();
      heartbeat();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeChat?.id]);

  useEffect(() => {
    loadRealChatList();
    loadRealMessages();

    const timer = setInterval(() => {
      loadRealChatList();
      if (activeChat && activeChat.id && !input.trim()) {
        loadRealMessages();
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [activeChat?.id]);

  // قائمة المحادثات الوهمية أزيلت.
// المحادثة تُفتح فقط مع المستخدم الحقيقي القادم من /api/users/search.
  const chatList = realChatList;

  const sendMessage = async () => {
    if (isSendingMessage) return;

    const text = input.trim();

    if (!text) return;

    if (!activeChat || !activeChat.id) {
      alert("اختر المستخدم أولاً");
      return;
    }

    if (userPoints < 5 && form?.role !== "owner") {
      alert("ليس لديك رصيد");
      return;
    }

    try {
      setIsSendingMessage(true);

      const response = await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          receiver_id: Number(activeChat.id),
          content: text
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(data?.message || "تعذر إرسال الرسالة");
        return;
      }

      // الرصيد الحقيقي يأتي من السيرفر
      if (
        typeof data.remaining_points !== "undefined" &&
        data.remaining_points !== null &&
        setUserPoints
      ) {
        setUserPoints(Number(data.remaining_points));
      }

      setInput("");

      // إعادة القراءة من قاعدة البيانات، وليس إضافة رسالة وهمية محلياً
      await loadRealMessages();

    } catch (error) {
      console.error("MESSAGE API ERROR:", error);
      alert("تعذر الاتصال بالسيرفر");
    } finally {
      setIsSendingMessage(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)', gap: '14px', boxSizing: 'border-box' }}>
      {!activeChat ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#fff', marginBottom: '8px', textAlign: 'right', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', color: '#ff6b8b', background: 'rgba(255,107,139,0.1)', padding: '4px 10px', borderRadius: '10px' }}>٢ غير مقروءة</span>
            <span>الدردشات</span>
          </div>
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: 'calc(100vh - 220px)' }}>
            {chatList.map(chat => (
              <div key={chat.id} onClick={() => setActiveChat(chat)} style={{ display: 'flex', alignItems: 'center', gap: '14px', background: 'linear-gradient(135deg, rgba(40,30,65,.8), rgba(20,15,35,.9))', padding: '16px', borderRadius: '20px', cursor: 'pointer', border: '1px solid rgba(255,107,139,0.18)', boxShadow:'0 8px 25px rgba(0,0,0,.25)', direction: 'rtl' }}>
                <div
                  onClick={async (e) => {
                    e.stopPropagation();

                    
                    try {

                      const response = await fetch(`/api/users/${chat.id}/profile`, {
                        headers: {
                        },
                        credentials:"include",
                      });

                      const data = await response.json();

                      
                      if (!response.ok || !data.success) {
                        alert(data.message || "تعذر فتح البروفايل");
                        return;
                      }

                      window.dispatchEvent(
                        new CustomEvent("suriana:open-user-profile", {
                          detail: data.profile
                        })
                      );
                    } catch (error) {
                      console.error("OPEN CHAT PROFILE ERROR:", error);
                      alert("تعذر فتح البروفايل");
                    }
                  }}
                  style={{ width: '52px', height: '52px', borderRadius: '50%', border:'3px solid #ff6b8b', backgroundImage: chat.img ? `url('${chat.img}')` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', cursor: 'pointer' }}>

                  {!chat.img && (
                    <span style={{ display:'flex', width:'100%', height:'100%', alignItems:'center', justifyContent:'center', fontSize:'24px' }}>
                      👤
                    </span>
                  )}
                  {chat.online && (
  <span style={{ position: 'absolute', bottom: '2px', left: '2px', width: '12px', height: '12px', borderRadius: '50%', background: '#10b981', border: '2px solid #0e0816' }} />
)}
                </div>
                <div style={{ flex: 1, textAlign: 'right' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 'bold', fontSize: '15px' }}>{chat.name} <span style={{ color: '#22d3ee', fontSize: '12px' }}>✓</span></span>
                    <span style={{ color: '#6b7280', fontSize: '11px' }}>{chat.time}</span>
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '220px' }}>{chat.lastMsg}</div>
                </div>
                {chat.unread > 0 && (
                  <div style={{ background: '#ec4899', color: '#fff', fontSize: '11px', fontWeight: 'bold', width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{chat.unread}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(30, 24, 46, 0.9)', padding: '12px 16px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.03)' }}>
            <button onClick={() => setActiveChat(null)} style={{ background: 'rgba(255,255,255,0.04)', border: 'none', color: '#ff6b8b', padding: '8px 16px', borderRadius: '14px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>❮ القائمة</button>
    <div style={{position:'relative'}}>
  <button
    onClick={()=>setShowMoreMenu(v=>!v)}
    style={{background:'rgba(255,255,255,0.04)',border:'none',color:'#fff',padding:'8px 14px',borderRadius:'14px',fontSize:'20px',cursor:'pointer'}}
  >⋮</button>

  {showMoreMenu && (
    <div style={{
      position:'absolute',
      top:'48px',
      left:'0',
      minWidth:'155px',
      maxWidth:'165px',
      background:'#241d35',
      border:'1px solid rgba(255,255,255,0.10)',
      borderRadius:'16px',
      padding:'6px',
      zIndex:1000,
      boxShadow:'0 12px 30px rgba(0,0,0,0.35)'
    }}>
      <button
        onClick={async()=>{
          if(!activeChat?.id) return;
          if(!window.confirm('هل تريد حذف هذه المحادثة من قائمتك؟')) return;
          try{

            const r=await fetch("/api/messages/conversations/hide/"+Number(activeChat.id),{
              method:"POST",
              headers:{},
              credentials:"include"
            });
            const d=await r.json();
            if(!r.ok || !d.success){
              alert(d.message || "تعذر حذف المحادثة");
              return;
            }
            setShowMoreMenu(false);
            setActiveChat(null);
            loadRealChatList();
          }catch(e){
            console.error("HIDE CHAT ERROR:",e);
            alert("تعذر حذف المحادثة");
          }
        }}
        style={{display:'block',width:'100%',background:'transparent',border:'none',color:'#ff6b8b',padding:'8px 9px',textAlign:'right',cursor:'pointer',fontSize:'12px',lineHeight:'1.3'}}
      >🗑️ حذف المحادثة</button>

      <button
        onClick={toggleBlock}
        style={{display:'block',width:'100%',background:'transparent',border:'none',color:'#fff',padding:'8px 9px',textAlign:'right',cursor:'pointer',fontSize:'12px',lineHeight:'1.3'}}
      >{isBlocked ? '✅ فك الحظر' : '🚫 حظر المستخدم'}</button>

      <button
        onClick={reportUser}
        style={{display:'block',width:'100%',background:'transparent',border:'none',color:'#ffd166',padding:'8px 9px',textAlign:'right',cursor:'pointer',fontSize:'12px',lineHeight:'1.3'}}
      >🚩 الإبلاغ عن المستخدم</button>
    </div>
  )}
</div>
{/* CHAT_MORE_MENU_READY */}
{/* CHAT_BLOCK_PRESENCE_HIDDEN */}
            <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '10px', direction: 'ltr' }}>
              <div
  onClick={async () => {
    try {

      const response = await fetch(`/api/users/${activeChat.id}/profile`, {
        headers: {
        },
        credentials:"include",
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        alert(data.message || "تعذر فتح البروفايل");
        return;
      }

      window.dispatchEvent(
        new CustomEvent("suriana:open-user-profile", {
          detail: data.profile
        })
      );
    } catch (error) {
      console.error("OPEN ACTIVE CHAT PROFILE ERROR:", error);
      alert("تعذر فتح البروفايل");
    }
  }}
  style={{
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border:'3px solid #ff6b8b',
    backgroundImage: activeChat.img ? `url('${activeChat.img}')` : 'none',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    cursor: 'pointer'
  }}
>
  {!activeChat.img && (
    <span style={{
      display:'flex',
      width:'100%',
      height:'100%',
      alignItems:'center',
      justifyContent:'center',
      fontSize:'20px'
    }}>
      👤
    </span>
  )}
</div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{activeChat.name} (محادثة حية)</div>
                <div style={{ color: (!isBlocked && otherOnline) ? '#10b981' : '#9ca3af', fontSize: '11px', marginTop: '2px' }}>
  {isBlocked
    ? '● غير متصل'
    : otherOnline
      ? '● متصل الآن'
      : otherLastSeen
        ? `آخر ظهور: ${new Date(String(otherLastSeen).replace(' ', 'T') + 'Z').toLocaleString('ar-SY', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}`
        : '● غير متصل'}
</div>
              </div>
            </div>
          </div>
          <div ref={messagesContainerRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', padding: '10px 4px' }}>
            {messages.map(msg => (
              <div key={msg.id} style={{ alignSelf: msg.sender === 'user' ? 'flex-start' : msg.sender === 'system' ? 'center' : 'flex-end', display: 'flex', flexDirection: 'column', alignItems: msg.sender === 'user' ? 'flex-start' : 'flex-end', maxWidth: '85%' }}>
                {msg.sender === 'system' ? (
                  <div style={{ background: 'rgba(255,255,255,0.06)', padding: '8px 16px', borderRadius: '14px', fontSize: '13px', color: '#9ca3af' }}>{msg.text}</div>
                ) : (
                  <div style={{ background: msg.sender === 'user' ? 'linear-gradient(45deg, #ff6b8b, #ec4899)' : 'rgba(255,255,255,0.06)', color: '#fff', padding: '12px 18px', borderRadius: msg.sender === 'user' ? '20px 20px 20px 4px' : '20px 20px 4px 20px', fontSize: '14px', position: 'relative', boxShadow: '0 4px 15px rgba(0,0,0,0.2)', textAlign: 'right', border: msg.sender === 'user' ? 'none' : '1px solid rgba(255,255,255,0.02)' }}>
                    <div>
  {msg.messageType === 'image' && msg.mediaUrl ? (
    <img
      src={msg.mediaUrl}
      alt="صورة"
      style={{
        display: 'block',
        maxWidth: '240px',
        maxHeight: '320px',
        borderRadius: '14px',
        objectFit: 'cover'
      }}
    />
  ) : msg.messageType === 'audio' && msg.mediaUrl ? (
    <audio
      controls
      src={msg.mediaUrl}
      style={{ maxWidth: '240px' }}
    />
  ) : (
    msg.text
  )}
</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '6px', fontSize: '10px', color: msg.sender === 'user' ? '#fca5a5' : '#6b7280' }}>
                      <span>{msg.time}</span>
                      {msg.sender === 'user' && <span style={{ color: msg.isRead ? '#38bdf8' : msg.isDelivered ? '#ffffff' : '#9ca3af', fontWeight: 'bold', letterSpacing: '-2px' }}>{msg.isDelivered ? '✓✓' : '✓'}</span>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 0' }}>
            <button
onClick={()=>setShowGiftBox(true)}
style={{
width:"42px",
height:"42px",
borderRadius:"50%",
border:"none",
background:"#ec4899",
color:"#fff",
fontSize:"18px"
}}

>🎁</button>



<button
onClick={async ()=>{
  if(!activeChat){
    alert("اختر مستخدم أولاً");
    return;
  }

  try{
      // مزامنة الرصيد الحقيقي من السيرفر قبل بدء المكالمة
      const meResponse = await fetch(window.location.origin + "/api/me",{
        signal: AbortSignal.timeout(5000),
        headers:{
        },
        credentials:"include",
      });

      const meData = await meResponse.json();

      if(!meResponse.ok || !meData.success || !meData.user){
        alert("تعذر قراءة رصيدك الحقيقي");
        return;
      }

      const realPoints = Number(meData.user.points || 0);

      if(setUserPoints){
        setUserPoints(realPoints);
      }

      if(realPoints < 25 && meData.user.role !== "owner"){
        alert("ليس لديك رصيد");
        return;
      }

const response = await fetch(window.location.origin + "/api/calls",{
      signal: AbortSignal.timeout(5000),
      method:"POST",
      headers:{
        "Content-Type":"application/json",
      },
      credentials:"include",
      body:JSON.stringify({
        receiver_id: activeChat.id,
        points:25
      })
    });

    const data = await response.json();

    if(!response.ok || !data.success){
      alert(data.message || "تعذر بدء المكالمة");
      return;
    }

    // مزامنة رصيد الواجهة مع الرصيد الحقيقي الذي قرأه السيرفر من DB
    if (typeof data.points !== "undefined" && setUserPoints) {
      setUserPoints(Number(data.points));
    }

    setCallSeconds(0);
    setCallPeerUserId(Number(activeChat.id));
    setActiveCallId(String(data.call_id));
    setIsCallInitiator(true);
    setCallStatus("ringing");
    setCallStartedAt(null);
    setMaxCallSeconds(data.max_seconds === null ? null : Number(data.max_seconds));

    setShowCallScreen(false);
    setInCall(false);

    }catch(e){
      console.error("CALL START ERROR:",e);
      alert("تعذر الاتصال بالسيرفر");
    }
  }}
    style={{
width:"42px",
height:"42px",
borderRadius:"50%",
border:"none",
background:"#22c55e",
color:"#fff",
fontSize:"18px"
}}
>{activeCallId ? "📞" : "📞"}</button>



{showGiftBox && (
<div style={{
position:"fixed",
bottom:"90px",
right:"20px",
left:"20px",
background:"#1a1525",
borderRadius:"25px",
padding:"20px",
zIndex:99,
border:"1px solid rgba(255,255,255,.1)"
}}>
<div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
<h3 style={{textAlign:"center"}}>🎁 اختر هدية</h3>
<button
onClick={()=>setShowGiftBox(false)}
style={{
background:"transparent",
border:"none",
color:"#fff",
fontSize:"22px",
cursor:"pointer"
}}
>
✕
</button>
</div>

<div style={{
display:"grid",
gridTemplateColumns:"repeat(2,1fr)",
gap:"10px"
}}>
{gifts.map(g=>(
<button
key={g.name}
onClick={()=>sendGift(g)}
style={{
padding:"12px",
borderRadius:"15px",
background:"#272033",
color:"#fff",
border:"none"
}}>
{g.name}
<br/>
{g.points} نقطة
</button>
))}
</div>

</div>
)}

{activeCallId && callStatus === "ringing" && (
  <div style={{
    position:"fixed", top:0, left:0, right:0, bottom:0,
    background:"#0b0712", zIndex:998,
    display:"flex", flexDirection:"column",
    alignItems:"center", justifyContent:"center", color:"#fff"
  }}>
    <h2>{activeChat?.name || "مستخدم"}</h2>

    <div style={{
      width:"120px", height:"120px", borderRadius:"50%",
      background:"#272033", display:"flex",
      alignItems:"center", justifyContent:"center",
      fontSize:"50px", margin:"30px"
    }}>
      📞
    </div>

    <h1>جاري الاتصال...</h1>
    <p>بانتظار قبول المكالمة</p>

    <button
      onClick={async ()=>{
        if(!activeCallId) return;

        const callId=activeCallId;

        try{
          const response=await fetch(
            window.location.origin + "/api/calls/"+callId+"/cancel",
            {
              method:"POST",
              headers:{
                "Content-Type":"application/json",
              },
              credentials:"include",
            }
          );

          const data=await response.json();

          if(!response.ok || !data.success){
            alert(data.message || "تعذر إلغاء المكالمة");
            return;
          }

          cleanupWebRTC();
          setCallPeerUserId(null);
          setActiveCallId(null);
          setCallStatus(null);
          setCallStartedAt(null);
          setMaxCallSeconds(null);
          setCallSeconds(0);
          setShowCallScreen(false);
          setInCall(false);

        }catch(e){
          console.error("CANCEL CALL ERROR:",e);
          alert("تعذر الاتصال بالسيرفر");
        }
      }}
      style={{
        marginTop:"60px",
        width:"70px",
        height:"70px",
        borderRadius:"50%",
        background:"#ef4444",
        color:"#fff",
        border:"none",
        fontSize:"30px"
      }}
    >
      ⛔
    </button>
  </div>
)}

{showCallScreen && (
<div style={{
 position:"fixed",
 top:0,
 left:0,
 right:0,
 bottom:0,
 background:"#0b0712",
 zIndex:999,
 display:"flex",
 flexDirection:"column",
 alignItems:"center",
 justifyContent:"center",
 color:"#fff"
}}>

<audio
  ref={remoteAudioRef}
  autoPlay
  playsInline
  style={{ display:"none" }}
/>

<h2>{activeChat?.name || "مستخدم"}</h2>

<div style={{
 width:"120px",
 height:"120px",
 borderRadius:"50%",
 background:"#272033",
 display:"flex",
 alignItems:"center",
 justifyContent:"center",
 fontSize:"50px",
 margin:"30px"
}}>
👤
</div>

<h1>
{String(Math.floor(callSeconds/60)).padStart(2,"0")}:
{String(callSeconds%60).padStart(2,"0")}
</h1>

<p>📞 مكالمة جارية</p>

<button
ref={endCallButtonRef}
  onClick={async ()=>{
  if(!activeCallId) return;
  

  const callId = activeCallId;

  try{
    const response = await fetch(window.location.origin + "/api/calls/end",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
      },
      credentials:"include",
      body:JSON.stringify({
        call_id:callId
      })
    });

    const data = await response.json();

    if(!response.ok || !data.success){
      alert(data.message || "تعذر إنهاء المكالمة");
      return;
    }


    if (typeof data.remaining_points !== "undefined" && setUserPoints) {
      setUserPoints(Number(data.remaining_points));
    }

    cleanupWebRTC();
    setCallPeerUserId(null);
    setActiveCallId(null);
    setMaxCallSeconds(null);
    setShowCallScreen(false);
    setInCall(false);

    alert("📞 انتهت المكالمة\n⏱️ المدة: "+data.minutes+" دقيقة");

  }catch(e){
    console.error("END CALL ERROR:",e);
    alert("تعذر الاتصال بالسيرفر");
  }
}}
style={{
 marginTop:"80px",
 width:"70px",
 height:"70px",
 borderRadius:"50%",
 background:"#ef4444",
 color:"#fff",
 border:"none",
 fontSize:"30px"
}}
>
⛔
</button>

</div>
)}

{/* INCOMING_CALL_UI */}
{incomingCall && (
  <div
    style={{
      position:"fixed",
      top:0,
      left:0,
      right:0,
      bottom:0,
      zIndex:2000,
      background:"rgba(11,7,18,0.96)",
      display:"flex",
      alignItems:"center",
      justifyContent:"center",
      padding:"20px"
    }}
  >
    <div
      style={{
        width:"100%",
        maxWidth:"380px",
        background:"#17111f",
        borderRadius:"28px",
        padding:"30px 22px",
        textAlign:"center",
        color:"#fff",
        boxShadow:"0 20px 60px rgba(0,0,0,0.5)"
      }}
    >
      <div
        style={{
          width:"100px",
          height:"100px",
          margin:"0 auto 20px",
          borderRadius:"50%",
          background:"#272033",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          fontSize:"46px"
        }}
      >
        👤
      </div>

      <h2 style={{margin:"0 0 10px"}}>
        {incomingCall.caller?.name || "مستخدم"}
      </h2>

      <p style={{margin:"0 0 28px",color:"#c4b5fd"}}>
        📞 اتصال وارد...
      </p>

      <div
        style={{
          display:"flex",
          gap:"14px",
          justifyContent:"center"
        }}
      >
        <button
          onClick={async ()=>{
            const callId = incomingCall.id;

            try{
              const response = await fetch(
                `${window.location.origin}/api/calls/${encodeURIComponent(callId)}/reject`,
                {
                  method:"POST",
                  headers:{
                  },
                  credentials:"include",
                }
              );

              const data = await response.json();

              if(!response.ok || !data.success){
                alert(data.message || "تعذر رفض المكالمة");
                return;
              }

              setIncomingCall(null);
            }catch(e){
              console.error("REJECT CALL ERROR:",e);
              alert("تعذر الاتصال بالسيرفر");
            }
          }}
          style={{
            flex:1,
            height:"52px",
            borderRadius:"18px",
            border:"none",
            background:"#ef4444",
            color:"#fff",
            fontSize:"18px",
            fontWeight:"bold"
          }}
        >
          ❌ رفض
        </button>

        <button
          onClick={async ()=>{
            const callId = incomingCall.id;

            try{
              const response = await fetch(
                `${window.location.origin}/api/calls/${encodeURIComponent(callId)}/accept`,
                {
                  method:"POST",
                  headers:{
                  },
                  credentials:"include",
                }
              );

              const data = await response.json();

              if(!response.ok || !data.success){
                alert(data.message || "تعذر قبول المكالمة");
                return;
              }

              const callerId = Number(incomingCall.caller_id);

              setIncomingCall(null);
              setCallPeerUserId(callerId);
              setActiveCallId(String(callId));
              setIsCallInitiator(false);
              setCallStatus("started");
              setCallStartedAt(data.started_at || null);
              setMaxCallSeconds(
                data.max_seconds === null
                  ? null
                  : Number(data.max_seconds)
              );
              setCallSeconds(0);
              setShowCallScreen(true);
              setInCall(true);
            }catch(e){
              console.error("ACCEPT CALL ERROR:",e);
              alert("تعذر الاتصال بالسيرفر");
            }
          }}
          style={{
            flex:1,
            height:"52px",
            borderRadius:"18px",
            border:"none",
            background:"#22c55e",
            color:"#fff",
            fontSize:"18px",
            fontWeight:"bold"
          }}
        >
          ✅ قبول
        </button>
      </div>
    </div>
  </div>
)}

  <div className="chat-composer-wrap">
    <button
      type="button"
      className="chat-plus-inside"
      onMouseDown={e => e.preventDefault()}
      onClick={() => setShowChatAttachMenu(v => !v)}
      disabled={isSendingMedia}
    >
      ＋
    </button>
    {showChatAttachMenu && (
                  <div className="chat-attach-menu">
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        setShowChatAttachMenu(false);
                        imageInputRef.current?.click();
                      }}
                    >
                      🖼️ المعرض
                    </button>

                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        
                        toggleAudioRecording();
                      }}
                    >
                      {isRecordingAudio ? "⏹️ إيقاف التسجيل" : "🎙️ تسجيل صوتي"}
                    </button>
                  </div>
                )}
  <div className="chat-composer-box">
  <input
    ref={imageInputRef}
    type="file"
    accept="image/jpeg,image/png,image/webp"
    style={{ display: "none" }}
    onChange={handleImageSelected}
  />


            

  <textarea
    ref={messageInputRef}
    value={input}
    placeholder="اكتب رسالتك الفخمة هنا..."
    className="input-custom chat-message-input chat-message-textarea"
    onChange={e => setInput(e.target.value)}
    onInput={e => {
      e.currentTarget.style.height = "auto";
      e.currentTarget.style.height =
        Math.min(e.currentTarget.scrollHeight, 120) + "px";
    }}
  />

  <button
    type="button"
    className="chat-send-inside"
    onMouseDown={e => e.preventDefault()}
    onClick={sendMessage}
  >
    🚀
  </button>
</div>
          </div>
  </div>
        </div>
      )}
    </div>
  );
}
