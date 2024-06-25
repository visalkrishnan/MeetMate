// Import the functions you need from the SDKs you need
import {initializeApp} from "firebase/app";
import {collection, doc, getFirestore, runTransaction, setDoc, onSnapshot, addDoc, getDoc, getDocs, updateDoc, deleteDoc, deleteField} from "firebase/firestore";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyAzkZ6h_b0t87mSQl1L6NmwjCP0GFjUjYU",
    authDomain: "webrtc-dfacc.firebaseapp.com",
    projectId: "webrtc-dfacc",
    storageBucket: "webrtc-dfacc.appspot.com",
    messagingSenderId: "855397544383",
    appId: "1:855397544383:web:3842bdf7a7534185bbb10a",
    measurementId: "G-ZZEBFDFQFP"
};

const servers = {
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
        },
    ],
    iceCandidatePoolSize: 10,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let userStream = new MediaStream()
let displayStream = new MediaStream()
let myId
let remoteNewPeers = []
let remoteConnectedPeers = []
let docId
let USERDOC
let username

/**
 * creates a new document in firebase, creates "users" subcollection and a document is added as "user-1"(the host) in "users".
 * "offercandidates" and "answercandidates" subcollections are added in "user-1"
 * when the host generates it's icecandidates, they are added to "offercandidates"
 * the "offer" of the host is added to "user-1" document
 * the host waits for an "answer" from a peer by listening to the "user-1" document
 * after getting an answer, the icecandidates of the remote peer is added to the peer connection  from "answercandidates"
  */
async function hostMeet() {
    const callDoc = getDOC();
    const userDoc = await addUserSubDocument(callDoc)
    USERDOC = userDoc
    const offerCandidates = collection(userDoc, 'offerCandidates');
    const answerCandidates = collection(userDoc, 'answerCandidates');

    let pc = await createPeerConnection(userDoc, offerCandidates)

    onSnapshot(userDoc, async (snapshot) => {
        const data = snapshot.data();
        // if there is an answer from a new user
        //!pc.currentRemoteDescription used so that when a new answer is added, the already established peer connections shouldn't take any action
        //only the new peer connection should take the action to establish the connection
        if (!pc.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answerDescription);

            getDocs(answerCandidates).then(querySnapshot => {
                querySnapshot.forEach(docSnapshot => {
                    // Now you have access to each document snapshot
                    const candidateData = docSnapshot.data();
                    const candidate = new RTCIceCandidate(candidateData);
                    pc.addIceCandidate(candidate);
                });
            });

            await newOffer()
        }
    });

    /**
     * after the host connects with a peer, the host will delete his current offer and icecandidates to generate a new one for a new connection
     * the host also deletes the existing answer and the icecanidates of the established connection
     * then waits for answer and icecandidates from a new user(defined above on "onsnapshot" method)
     */
    async function newOffer() {
        await updateDoc(userDoc, {offer: deleteField()});
        const offerCandidatesSnapshot = await getDocs(offerCandidates);
        offerCandidatesSnapshot.forEach(offerCandidateDoc => {
            deleteDoc(offerCandidateDoc.ref);
        });

        await updateDoc(userDoc, {answer: deleteField()});
        const answerCandidatesSnapshot = await getDocs(answerCandidates);
        answerCandidatesSnapshot.forEach(answerCandidateDoc => {
            deleteDoc(answerCandidateDoc.ref);
        });

        pc = await createPeerConnection(userDoc, offerCandidates)
    }
}

/**
 * the guest joins the meet with the document id then refers to "users" collection where he will find the users that are on the meeting
 * with the names user-1(host), user-2 etc.....
 * with each user he will establish a peer connection
 * then he will call the hostMeet function to create a document for him "user-x" and proceeds in the way of how the host behaves
 * so that future arriving users can connect with him
 * the only difference being the call document already exist created by the original host
 */
async function joinMeet() {
    // Reference to the 'calls' collection and the specific call document
    const callDoc = getDOC()
    await addUserSubDocument(callDoc, true)

    // Reference to the 'users' subcollection
    const users = collection(callDoc, 'users');

    // Function to handle the offer and answer process for each user
    async function handleOfferAndAnswerForUser(userDoc) {
        const pc = new RTCPeerConnection(servers)
        manageConnection(pc)
        handleMedia(pc)
        const offerCandidates = collection(userDoc, 'offerCandidates');
        const answerCandidates = collection(userDoc, 'answerCandidates');

        pc.onicecandidate = event => {
            if (event.candidate) {
                addDoc(answerCandidates, event.candidate.toJSON());
            }
        };

        const userDocSnapshot = await getDoc(userDoc);
        const offer = userDocSnapshot.data().offer;
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        
        const offerCandidatesSnapshot = await getDocs(offerCandidates);
        offerCandidatesSnapshot.forEach(offerCandidateDoc => {
            const candidate = new RTCIceCandidate(offerCandidateDoc.data());
            pc.addIceCandidate(candidate);
        });

        const answerDescription = await pc.createAnswer();
        const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
        };
        await pc.setLocalDescription(new RTCSessionDescription(answerDescription));

        await updateDoc(userDoc, {answer});
    }

    // Iterate over each user in the call
    getDocs(users).then(usersSnapshot => {
        usersSnapshot.forEach(userDoc => {
            handleOfferAndAnswerForUser(userDoc.ref);
        });
    }).catch(error => {
        console.error("Error processing users in the call:", error);
    });

    await hostMeet()

}

async function createPeerConnection(userDoc, offerCandidates, ExistingPeer) {
    let pc
    if (ExistingPeer) {
        pc = ExistingPeer
    } else {
        pc = new RTCPeerConnection(servers)
        manageConnection(pc)
        handleMedia(pc)

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(offerCandidates, event.candidate.toJSON());
        };
    }

    let offerDescription = await pc.createOffer();
    await pc.setLocalDescription(offerDescription);

    const offer = {
        sdp: offerDescription.sdp,
        type: offerDescription.type,
    };
    await setDoc(userDoc, {offer});
    // Set an interval to poll the connection state every 5 seconds
    // setInterval(checkConnectionState, 5000);
    return pc
}
// // Assume we have an RTCPeerConnection instance called peerConnection
//
// // Function to check the connection state
// function checkConnectionState(pc) {
//     pc.getStats(null).then(stats => {
//         let connected = false;
//
//         stats.forEach(report => {
//             // Check the candidate pair report for a successful connection
//             if (report.type === 'candidate-pair' && report.state === 'succeeded') {
//                 connected = true;
//             }
//         });
//
//         if (!connected) {
//             // Handle the disconnection
//             handleDisconnection();
//         }
//     });
// }
//
// // Function to handle the disconnection
// function handleDisconnection(pc, mediaElement) {
//     // Close the peer connection
//     pc.close();
//
//     // Remove media elements or perform other cleanup
//     mediaElement.remove()
//
// }
//
// Function to add a user sub-document
async function addUserSubDocument(callDoc, assignId = false) {
    // Start a transaction to ensure atomic operations
    return await runTransaction(db, async (transaction) => {
        // Get the current state of the main document
        const callDocSnapshot = await transaction.get(callDoc);

        // If the main document does not exist, create it with a counter
        if (!callDocSnapshot.exists()) {
            transaction.set(callDoc, { userCount: 0 });
        }

        // Get the current user count
        const userCount = callDocSnapshot.data()?.userCount || 0;
        // Increment the user count
        const newUserCount = userCount + 1;
        myId = newUserCount;
        Array.from(document.getElementsByClassName("user")).forEach(function(element) {
            element.innerHTML = ` (User ${myId})`;
        });
        if (assignId) {
            return 
        }
        // Update the main document with the new user count
        transaction.update(callDoc, { userCount: newUserCount });

        // Create a new sub-document name using the updated count
        const userSubDocName = `user-${newUserCount}`;
        // Return reference to the new sub-document
        return doc(callDoc, 'users', userSubDocName);
    });
}

function getDOC() {
    if (!docId) {
        const docu =  doc(collection(db, 'calls'));
        answerDiv.style.display = "none"
        callButton.style.display = "none"
        optionsDiv.style.justifyContent = "center"
        meetDiv.style.display = "block"
        meetId.insertAdjacentText("beforeend", docu.id)
        navigator.clipboard.writeText(docu.id)
            .then(() => {
                // Success message
                meetIdStatus.innerText = "Meet ID copied to clipboard";
            })
        docId = docu.id;
        return docu
    }
    return doc(db, 'calls', docId)
}

// function handleMediaChannel (pc) {
//     const mediaTypeChannel = pc.createDataChannel("mediaType", {
//         negotiated: true,
//         id: 0
//     });
//     let syncCounter = 0
//     mediaTypeChannel.onopen = (event) => {
//         if (userStream.active) {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "userStream", id: userStream.id}));
//             mediaTypeChannel.send(JSON.stringify({syncCounter: syncCounter++, type: "userStream"}))
//             mediaTypeChannel.onmessage = event => {
//                 if (event.data === syncCounter - 1) {
//                     userStream.getTracks().forEach((track) => {
//                         pc.addTrack(track, userStream);
//                     });
//                 }
//             }
//         }
//         if (displayStream.active) {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "displayStream", id: displayStream.id}));
//             mediaTypeChannel.send(JSON.stringify({type: "userStream", id: userStream.id}));
//         }
//
//         userStream.onaddtrack = (event) => {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "userStream", id: userStream.id}));
//             mediaTypeChannel.send(JSON.stringify({type: "userStream", id: userStream.id}));
//         }
//         displayStream.onaddtrack = (event) => {
//             // mediaTypeChannel.send(JSON.stringify({userId: myId, type: "displayStream", id: displayStream.id}));
//             mediaTypeChannel.send(JSON.stringify({type: "userStream", id: userStream.id}));
//         }
//     }
//
//     mediaTypeChannel.onmessage = (event) => {
//         const streamType = event.data;
//         // console.log("recieved stream", stream);
//         // // Check if the user entry exists in remotePeers
//         // if (remotePeers[stream.userId]) {
//         //     // If it exists, simply update the stream type with the new id
//         //     remotePeers[stream.userId][stream.type] = stream.id;
//         // } else {
//         //     // If it doesn't exist, create a new entry with the stream type and id
//         //     remotePeers[stream.userId] = { [stream.type]: stream.id };
//         // }
//         let remoteStream = new MediaStream()
//         let remoteDisplayStream = new MediaStream()
//         // Pull tracks from remote stream, add to video stream
//         pc.ontrack = (event) => {
//             // console.log(remotePeers)
//             // setTimeout(()=>{
//             //     console.log(remotePeers)
//             // }, 3000)
//             event.streams.forEach((stream) => {
//                 if (streamType === "user") {
//                     if (!remoteStream.active) {
//                         addVideo(remoteStream);
//                     }
//                     else {
//                         remoteStream.getTracks().forEach((track) => {
//                             track.stop()
//                             remoteStream.removeTrack(track);
//                         })
//                     }
//                     stream.getTracks().forEach((track) => {
//                         remoteStream.addTrack(track);
//                     });
//                 }
//                 else if (streamType === "display") {
//                     if (!remoteDisplayStream.active) {
//                         addVideo(remoteDisplayStream, false, true);
//                     }
//                     else {
//                         remoteDisplayStream.getTracks().forEach((track) => {
//                             track.stop()
//                             remoteDisplayStream.removeTrack(track);
//                         })
//                     }
//                     stream.getTracks().forEach((track) => {
//                         remoteDisplayStream.addTrack(track);
//                     });
//                 }
//             });
//         };
//     }
// }

function handleMedia(pc) {
    let remoteStream = new MediaStream()
    let remoteDisplayStream = new MediaStream()

    if (userStream.active) {
        userStream.getTracks().forEach((track) => {
            pc.addTrack(track, userStream);
        });
    }

    if (displayStream.active) {
        displayStream.getTracks().forEach((track) => {
            pc.addTrack(track, displayStream, new MediaStream());
        })
    }

    pc.ontrack = (event) => {
        if (event.streams[1]) { // check whether display stream was received
            if (!remoteDisplayStream.active) {
                remoteDisplayStream = event.streams[0]
                addVideo(remoteDisplayStream, false, true, pc)
            }
            else {
                remoteDisplayStream = event.streams[0]
            }
        }
        else { // else the user stream was received
            if (!remoteStream.active) {
                remoteStream = event.streams[0]
                addVideo(remoteStream, false, false, pc)
            }
            else {
                remoteStream = event.streams[0]
            }
        }
    }
}

function manageConnection(pc) {
    remoteNewPeers.push(pc)
    manageRenegotiation(pc)
    manageRemoteId(pc)
    manageRemoteName(pc)
    endConnection(pc)
    manageChat(pc)
    manageFile(pc)

    pc.onconnectionstatechange = ((event)=>{
        switch(pc.connectionState) {
            case "connected":
                remoteConnectedPeers.push(pc)
                remoteNewPeers = remoteNewPeers.filter(peerConnection => peerConnection !== pc)
                break
            case "closed":
                handleClosed(pc)
                break
        }
    })
}

function manageRenegotiation(pc) {
    const renegotiateChannel = pc.createDataChannel("renegotiate", {
        negotiated: true,
        id: 0
    });

    renegotiateChannel.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.offer) {
            await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
            // Create an answer
            pc.createAnswer().then(async answer => {
                await pc.setLocalDescription(answer);
                // Send the answer back through the renegotiateChannel
                renegotiateChannel.send(JSON.stringify({'answer': answer}));
            });
        }
        else {
            await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        }
    }

    pc.onnegotiationneeded = ((event) => {
        if (pc.connectionState === "connected") { // renegotiating after the initial connection is established
            renegotiate(pc, renegotiateChannel)
        }
    })
}

function renegotiate(pc, renegotiateChannel) {
    pc.createOffer().then(async offer => {
        await pc.setLocalDescription(offer);
        // Use the renegotiateChannel to send the offer to the remote peer
        renegotiateChannel.send(JSON.stringify({'offer': offer}));
    });
}

function manageRemoteId(pc) {
    const remoteIdChannel = pc.createDataChannel("remoteId", {
        negotiated: true,
        id: 1
    });

    remoteIdChannel.onopen = (()=>{
        remoteIdChannel.send(myId);
    })

    remoteIdChannel.onmessage = (event) => {
        pc.remoteId = event.data;
        if (!pc.remoteName) {
            pc.remoteName = `User ${event.data}`
        }
        if (pc.remoteDivHead) {
            pc["remoteDivHead"].innerText = pc.remoteName
        }
        if (pc.remoteScreenDivHead) {
            pc["remoteScreenDivHead"].innerText = `${pc.remoteName}'s Screen`
        }
    }
}

function manageRemoteName(pc) {
    const remoteNameChannel = pc.createDataChannel("remoteName", {
        negotiated: true,
        id: 2
    });

    remoteNameChannel.onopen = (()=>{
        if (username) {
            remoteNameChannel.send(username)
        }
        const nameButton = document.getElementById("nameButton")
        const nameInput = document.getElementById("name")
        nameInput.oninput = ((event) => {
            nameButton.innerText = "Apply"
        })
        nameButton.addEventListener("click", () => {
            const name = nameInput.value;
            if (name) {
                username = name; // Update the username
                remoteNameChannel.send(username); // Send the updated name
                nameButton.innerText = "Change";
            }
        });
    })

    remoteNameChannel.onmessage = (event) => {
        pc.remoteName = `${event.data} (User ${pc.remoteId})`;
        if (pc.remoteDivHead) {
            pc["remoteDivHead"].innerText = pc.remoteName
        }
        if (pc.remoteScreenDivHead) {
            pc["remoteScreenDivHead"].innerText = `${pc.remoteName}'s Screen`
        }
    }
}

function endConnection(pc) {
    const endChannel = pc.createDataChannel("end", {
        negotiated: true,
        id: 3
    });

    endChannel.onopen = (()=>{
        window.addEventListener('beforeunload', (event) => {
            deleteDoc(USERDOC)
            endChannel.send("end")
        });
    })

    endChannel.onmessage = (event) => {
        pc.close()
        handleClosed(pc)
    }
}

function handleClosed(pc) {
    remoteConnectedPeers = remoteConnectedPeers.filter(peerConnection => peerConnection !== pc)
    if (pc.remoteDiv) {
        pc.remoteDiv.remove()
    }
    if (pc.remoteScreenDiv) {
        pc.remoteScreenDiv.remove()
    }
}

// -------------------------     utilities      -----------------------------------

function addVideo(stream, user = false, screen = false, pc) {
    const div = document.createElement('div');
    div.classList.add("video-container-div")

    const heading = document.createElement('h3');
    if (screen && user) {
        heading.innerHTML = `Your Screen<span class="user">${myId ? ` (User ${myId})` : ''}</span>`;
    }
    else if (screen) {
        if (pc.remoteName) {
            heading.innerText = `${pc.remoteName}'s Screen`;
        }
        else {
            if (pc.remoteId) {
                heading.innerText = `User ${pc.remoteId}'s Screen`;
            }
            else {
                heading.innerText = "User Screen"
            }
        }
        pc.remoteScreenDivHead = heading
        pc.remoteScreenDiv = div
    }
    else {
        if (pc.remoteName) {
            heading.innerText = pc.remoteName;
        }
        else {
            if (pc.remoteId) {
                heading.innerText = `User ${pc.remoteId}`;
            }
            else {
                heading.innerText = "User"
            }
        }
        pc.remoteDivHead = heading
        pc.remoteDiv = div
    }

    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.srcObject = stream
    video.controls = true

    div.appendChild(heading)
    div.appendChild(video);
    document.getElementById("video-container").appendChild(div);
}

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const screenShareButton = document.getElementById('screenShareButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');
const answerDiv = document.getElementById("answer")
const optionsDiv = document.getElementById("meet-options")
const meetDiv = document.getElementById("meet")
const meetId = document.getElementById("meet-id")
const meetIdStatus = document.getElementById("meet-id-status")



webcamButton.onclick = () => {
    navigator.mediaDevices.getUserMedia({audio: true, video: true})
        .then(async (stream) => {
            userStream = stream
            webcamVideo.srcObject = userStream
            webcamVideo.controls = true
            for (const track of userStream.getTracks()) {
                for (const pc of remoteNewPeers) {
                    pc.addTrack(track, userStream);
                    const offerCandidates = collection(USERDOC, 'offerCandidates');
                    await createPeerConnection(USERDOC, offerCandidates, pc);
                }
                remoteConnectedPeers.forEach(pc => {
                    pc.addTrack(track, userStream);
                })
            }
            callButton.disabled = false;
            answerButton.disabled = false;
            webcamButton.disabled = true;
        })
}

screenShareButton.onclick = () => {
    navigator.mediaDevices.getDisplayMedia({
        video: {
            cursor: "always"
        },
        audio: false
    })
        .then(async (stream) => {
            displayStream = stream
            addVideo(displayStream, true, true)
            for (const track of displayStream.getTracks()) {
                for (const pc of remoteNewPeers) {
                    pc.addTrack(track, displayStream, new MediaStream());
                    const offerCandidates = collection(USERDOC, 'offerCandidates');
                    await createPeerConnection(USERDOC, offerCandidates, pc);
                }
                remoteConnectedPeers.forEach(pc => {
                    pc.addTrack(track, displayStream, new MediaStream());
                })
            }
            callButton.disabled = false;
            answerButton.disabled = false;
            screenShareButton.disabled = true;
        })
}

callButton.onclick = async () => {
    hangupButton.disabled = false
    enableSection()
    getDOC()
    await hostMeet()
}

answerButton.onclick = async () => {
    hangupButton.disabled = false;
    enableSection()
    docId = callInput.value;
    answerDiv.style.display = "none"
    callButton.style.display = "none"
    optionsDiv.style.justifyContent = "center"
    await joinMeet()
}

const nameButton = document.getElementById("nameButton")
const nameInput = document.getElementById("name")
nameInput.oninput = ((event) => {
    nameButton.innerText = "Apply"
})
nameButton.onclick = ((event) => {
    const name = nameInput.value
    if (name) {
        username = name
        nameButton.innerText = "Change"
    }
})

document.getElementById("hangupButton").onclick = ((event)=>{
    window.location.reload()
})

// ---------------------- chat ------------------------------------

let element = $('.floating-chat');
let myStorage = localStorage;

if (!myStorage.getItem('chatID')) {
    myStorage.setItem('chatID', createUUID());
}

setTimeout(function() {
    element.addClass('enter');
}, 1000);

element.click(openElement);

function openElement() {
    let messages = element.find('.messages');
    let textInput = element.find('.text-box');
    element.find('>i').hide();
    element.addClass('expand');
    element.find('.chat').addClass('enter');
    let strLength = textInput.val().length * 2;
    textInput.keydown(onMetaAndEnter).prop("disabled", false).focus();
    element.off('click', openElement);
    element.find('.header button').click(closeElement);
    element.find('#sendMessage').click(sendNewMessage);
    messages.scrollTop(messages.prop("scrollHeight"));
}

function closeElement() {
    element.find('.chat').removeClass('enter').hide();
    element.find('>i').show();
    element.removeClass('expand');
    element.find('.header button').off('click', closeElement);
    element.find('#sendMessage').off('click', sendNewMessage);
    element.find('.text-box').off('keydown', onMetaAndEnter).prop("disabled", true).blur();
    setTimeout(function() {
        element.find('.chat').removeClass('enter').show()
        element.click(openElement);
    }, 500);
}

function createUUID() {
    // http://www.ietf.org/rfc/rfc4122.txt
    let s = [];
    let hexDigits = "0123456789abcdef";
    for (let i = 0; i < 36; i++) {
        s[i] = hexDigits.substr(Math.floor(Math.random() * 0x10), 1);
    }
    s[14] = "4"; // bits 12-15 of the time_hi_and_version field to 0010
    s[19] = hexDigits.substr((s[19] & 0x3) | 0x8, 1); // bits 6-7 of the clock_seq_hi_and_reserved to 01
    s[8] = s[13] = s[18] = s[23] = "-";

    let uuid = s.join("");
    return uuid;
}

function sendNewMessage() {
    let userInput = $('.text-box');
    let newMessage = userInput.html().replace(/\<div\>|\<br.*?\>/ig, '\n').replace(/\<\/div\>/g, '').trim().replace(/\n/g, '<br>');

    if (!newMessage) return;

    let messagesContainer = $('.messages');

    messagesContainer.append([
        '<li class="self">',
        newMessage,
        '</li>'
    ].join(''));

    // clean out old message
    userInput.html('');
    // focus on input
    userInput.focus();

    messagesContainer.finish().animate({
        scrollTop: messagesContainer.prop("scrollHeight")
    }, 250);
}

function onMetaAndEnter(event) {
    if ((event.metaKey || event.ctrlKey) && event.keyCode == 13) {
        sendNewMessage();
    }
}


function manageChat(pc) {
    const chatChannel = pc.createDataChannel("chat", {
        negotiated: true,
        id: 4
    });

    chatChannel.onopen = (()=>{
        pc.chatChannel = chatChannel
        document.getElementById('sendMessage').addEventListener('click', (event) => {
            const textBox = document.querySelector('.text-box');
            const message = textBox.innerText;

            if (message) {
                // Create a new <li> for self-sent message
                const selfMessageLi = document.createElement('li');
                selfMessageLi.classList.add('self');
                selfMessageLi.textContent = message;
                document.getElementById('messages').appendChild(selfMessageLi);

                // Send the message to all connected peers
                for (const key in remoteConnectedPeers) {
                    // Ensure that the chatChannel exists before sending
                    if (remoteConnectedPeers[key].chatChannel) {
                        remoteConnectedPeers[key].chatChannel.send(message);
                    }
                }

                // Clear the text box's innerText
                textBox.innerText = '';
            }
        })
    })

    chatChannel.onmessage = ((event) => {
        const receivedMessage = event.data;
        const otherMessageLi = document.createElement('li');
        otherMessageLi.classList.add('other');
        otherMessageLi.textContent = `${pc.remoteName}: ${receivedMessage}`
        document.getElementById('messages').appendChild(otherMessageLi);
    })
}
// ------------- file transfer ----------------
let fileReader;
const bitrateDiv = document.querySelector('div#bitrate');
const fileInput = document.querySelector('input#fileInput');
const abortButton = document.querySelector('button#abortButton');
const downloadAnchor = document.querySelector('a#download');
const sendProgress = document.querySelector('progress#sendProgress');
const receiveProgress = document.querySelector('progress#receiveProgress');
const statusMessage = document.querySelector('span#status');
const sendFileButton = document.querySelector('button#sendFile');

let receiveBuffer = [];
let receivedSize = 0;

let bytesPrev = 0;
let timestampPrev = 0;
let timestampStart;
let statsInterval = null;
let bitrateMax = 0;

sendFileButton.addEventListener('click', () => sendFile());
fileInput.addEventListener('change', handleFileInputChange, false);
abortButton.addEventListener('click', () => {
    if (fileReader && fileReader.readyState === 1) {
        //console.log('Abort read!');
        fileReader.abort();
    }
});

async function handleFileInputChange() {
    const file = fileInput.files[0];
    if (!file) {
        //console.log('No file chosen');
    } else {
        sendFileButton.disabled = false;
    }
}

function sendFile() {
    abortButton.disabled = false;
    sendFileButton.disabled = true;
    fileInput.disabled = true;

    // Send the message to all connected peers
    for (const key in remoteConnectedPeers) {
        // Ensure that the chatChannel exists before sending
        if (remoteConnectedPeers[key].fileChannel) {
            sendData(remoteConnectedPeers[key].fileChannel)
        }
    }

    abortButton.disabled = true;
    fileInput.disabled = false;
}

function sendMetadata(sendChannel, file) {
    const metadata = JSON.stringify({
        'fileName': file.name,
        'fileSize': file.size,
        'fileType': file.type
    });
    sendChannel.send(metadata);
}

function sendData(sendChannel) {
    const file = fileInput.files[0];
    sendMetadata(sendChannel, file);
    //console.log(`File is ${[file.name, file.size, file.type, file.lastModified].join(' ')}`);

    // Handle 0 size files.
    statusMessage.textContent = '';
    downloadAnchor.textContent = '';
    if (file.size === 0) {
        bitrateDiv.innerHTML = '';
        statusMessage.textContent = 'File is empty, please select a non-empty file';
        handleZeroSize();
        return;
    }
    sendProgress.max = file.size;
    receiveProgress.max = file.size;
    const chunkSize = 16384;
    const fileReader = new FileReader();
    let offset = 0;
    fileReader.addEventListener('error', error => console.error('Error reading file:', error));
    fileReader.addEventListener('abort', event => console.log('File reading aborted:', event));
    fileReader.addEventListener('load', e => {
        //console.log('FileRead.onload ', e);
        sendChannel.send(e.target.result);
        offset += e.target.result.byteLength;
        sendProgress.value = offset;
        if (offset < file.size) {
            readSlice(offset);
        }
    });
    const readSlice = o => {
        //console.log('readSlice ', o);
        const slice = file.slice(offset, o + chunkSize);
        fileReader.readAsArrayBuffer(slice);
    };
    readSlice(0);
}

function handleZeroSize() {
    // re-enable the file select
    fileInput.disabled = false;
    abortButton.disabled = true;
    sendFileButton.disabled = false;
}

let fileMetadata = null;
async function onReceiveMessageCallback(event, pc) {
    if (!fileMetadata) {
        // The first message should be the metadata
        fileMetadata = JSON.parse(event.data);
        // Set up the receive progress max value
        receiveProgress.max = fileMetadata.fileSize;

        timestampStart = (new Date()).getTime();
        timestampPrev = timestampStart;
        statsInterval = setInterval(displayStats, 500);
        await displayStats(pc);

        receivedSize = 0;
        bitrateMax = 0;
        downloadAnchor.textContent = '';
        downloadAnchor.removeAttribute('download');
        if (downloadAnchor.href) {
            URL.revokeObjectURL(downloadAnchor.href);
            downloadAnchor.removeAttribute('href');
        }

        // Now wait for the file data messages
        return;
    }
    //console.log(`Received Message ${event.data.byteLength}`);
    receiveBuffer.push(event.data);
    receivedSize += event.data.byteLength;
    receiveProgress.value = receivedSize;

    // we are assuming that our signaling protocol told
    // about the expected file size (and name, hash, etc).
    //const file = fileInput.files[0];
    if (receivedSize === fileMetadata.fileSize) {
        console.log("the size has become equal")
        const received = new Blob(receiveBuffer);
        receiveBuffer = [];

        downloadAnchor.href = URL.createObjectURL(received);
        downloadAnchor.download = fileMetadata.fileName;
        downloadAnchor.textContent =
            `Click to download '${fileMetadata.fileName}' (${fileMetadata.fileSize} bytes)`;
        downloadAnchor.style.display = 'block';

        const bitrate = Math.round(receivedSize * 8 /
            ((new Date()).getTime() - timestampStart));
        bitrateDiv.innerHTML =
            `<strong>Average Bitrate:</strong> ${bitrate} kbits/sec (max: ${bitrateMax} kbits/sec)`;
        fileMetadata = null
        if (statsInterval) {
            clearInterval(statsInterval);
            statsInterval = null;
        }
    }
}

// display bitrate statistics.
async function displayStats(pc) {
    if (pc && pc.iceConnectionState === 'connected') {
        const stats = await pc.getStats();
        let activeCandidatePair;
        stats.forEach(report => {
            if (report.type === 'transport') {
                activeCandidatePair = stats.get(report.selectedCandidatePairId);
            }
        });
        if (activeCandidatePair) {
            if (timestampPrev === activeCandidatePair.timestamp) {
                return;
            }
            // calculate current bitrate
            const bytesNow = activeCandidatePair.bytesReceived;
            const bitrate = Math.round((bytesNow - bytesPrev) * 8 /
                (activeCandidatePair.timestamp - timestampPrev));
            bitrateDiv.innerHTML = `<strong>Current Bitrate:</strong> ${bitrate} kbits/sec`;
            timestampPrev = activeCandidatePair.timestamp;
            bytesPrev = bytesNow;
            if (bitrate > bitrateMax) {
                bitrateMax = bitrate;
            }
        }
    }
}

function manageFile(pc) {
    const fileChannel = pc.createDataChannel("file", {
        negotiated: true,
        id: 5
    });
    fileChannel.binaryType = 'arraybuffer'

    fileChannel.onopen = (() => {
        pc.fileChannel = fileChannel
    })

    fileChannel.onmessage = (event) => onReceiveMessageCallback(event, pc);
}

// chat and file enabler
function enableSection() {
    document.querySelector("#fileSection").style.display = "block"
    document.querySelector("#chatSection").style.display = "flex"
    document.querySelector("#recordSection").style.display = "block"
}

//-------screen recording-----------

const startButton = document.getElementById('startRecording');
const stopButton = document.getElementById('stopRecording');
const recordedVideo = document.getElementById('recordedVideo');

let mediaRecorder;
let recordedChunks = [];

startButton.addEventListener('click', async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true
    });

    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = function(event) {
        if (event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    };

    mediaRecorder.onstop = function() {
        const blob = new Blob(recordedChunks, {
            type: 'video/webm'
        });
        recordedChunks = [];
        const url = URL.createObjectURL(blob);
        recordedVideo.src = url;
    };

    mediaRecorder.start();
    startButton.disabled = true;
    stopButton.disabled = false;
});

stopButton.addEventListener('click', () => {
    mediaRecorder.stop();
    document.querySelector("#recordedVideo").style.display="inline"
    startButton.disabled = false;
    stopButton.disabled = true;
});