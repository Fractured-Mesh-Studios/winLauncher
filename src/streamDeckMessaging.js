function createStreamDeckMessaging(ws) {
  function sendToInspector(context, action, payload) {
    ws.send(JSON.stringify({
      action,
      event: 'sendToPropertyInspector',
      context,
      payload
    }));
  }

  function setKeyImage(context, dataUrl) {
    if (!context || !dataUrl) {
      return;
    }

    ws.send(JSON.stringify({
      event: 'setImage',
      context,
      payload: {
        image: dataUrl,
        target: 0
      }
    }));

    ws.send(JSON.stringify({
      event: 'setImage',
      context,
      payload: {
        image: dataUrl,
        target: 1
      }
    }));
  }

  return {
    sendToInspector,
    setKeyImage
  };
}

module.exports = {
  createStreamDeckMessaging
};
