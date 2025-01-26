/************************************
 * Configuration
 ************************************/

/**
 * linesConfig: each object represents a station/line we want to track.
 * 
 * 7 Train at 82nd St
 * R Train at Roosevelt (Astoria)
 * E Train at Roosevelt (Manhattan)
 * F Train at Roosevelt (Manhattan)
 */
const linesConfig = [
    {
      // 7 Train at 82nd St
      feedUrl: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs',
      stationIdBase: '709', /* 82nd St station code */
      lineName: '7 Train at 82nd St – Jackson Heights',
      hideThreshold: 8 // If arrival < 8 min, hide it
    },
    {
      // R Train at Roosevelt (for Astoria direction)
      feedUrl: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw',
      stationIdBase: 'G14',
      lineName: 'R Train at Roosevelt Ave',
      hideThreshold: 14 // If arrival < 14 min, hide it
    },
    {
      // E Train at Roosevelt (for Manhattan)
      feedUrl: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace',
      stationIdBase: 'G14',
      lineName: 'E Train at Roosevelt Ave',
      hideThreshold: 14
    },
    {
      // F Train at Roosevelt (for Manhattan)
      feedUrl: 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm',
      stationIdBase: 'G14',
      lineName: 'F Train at Roosevelt Ave',
      hideThreshold: 14
    }
  ];
  
  /** If the MTA feed requires a key, set it here */
  const MTA_API_KEY = ''; // e.g. 'YOUR_MTA_API_KEY'
  
  /**
   * How often we FETCH data (ms).
   * (You said 15 seconds, we changed the setInterval below to 30 in your code, 
   * you can choose. We'll keep 15 for now.)
   */
  const FETCH_INTERVAL_MS = 15000;
  
  /**
   * How often we UPDATE the countdowns on screen (ms).
   */
  const COUNTDOWN_INTERVAL_MS = 1000;
  
  
  /************************************
   * Globals
   ************************************/
  let allTrainUpdates = []; // tracks each <p> for inbound/outbound
  const linesContainer = document.getElementById('lines-container');
  
  
  /************************************
   * Initialization & Auto-Refresh
   ************************************/
  
  /** Render sections for each line & fetch data. */
  function renderAllLines() {
    // Clear old inbound/outbound data
    linesContainer.innerHTML = '';
    // Reset references
    allTrainUpdates = [];
  
    // For each line/station in our config
    linesConfig.forEach(config => {
      // Create inbound/outbound containers inside linesContainer
      const section = document.createElement('section');
      section.className = 'line-section';
  
      const heading = document.createElement('h2');
      heading.textContent = config.lineName;
      section.appendChild(heading);
  
      const inboundDiv = document.createElement('div');
      inboundDiv.innerHTML = '<h3>Inbound (Manhattan-bound)</h3>';
      section.appendChild(inboundDiv);
  
      const outboundDiv = document.createElement('div');
      outboundDiv.innerHTML = '<h3>Outbound (Queens-bound)</h3>';
      section.appendChild(outboundDiv);
  
      linesContainer.appendChild(section);
  
      // Fetch data & fill inbound/outbound
      fetchDataForStation(config, inboundDiv, outboundDiv);
    });
  }
  
  // First render on page load
  renderAllLines();
  
  // Re-fetch every 15 seconds
  setInterval(renderAllLines, FETCH_INTERVAL_MS);
  
  // Update countdowns every 1 second
  setInterval(updateAllCountdowns, COUNTDOWN_INTERVAL_MS);
  
  
  /************************************
   * Core Fetch & Display Logic
   ************************************/
  
  /**
   * Fetch GTFS-RT feed, decode, filter by station ID,
   * limit to 3 inbound/outbound, then set leave messages.
   */
  function fetchDataForStation(config, inboundContainer, outboundContainer) {
    fetch(config.feedUrl, {
      headers: MTA_API_KEY ? { 'x-api-key': MTA_API_KEY } : {}
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was not ok for feed: ${config.feedUrl}`);
        }
        return response.arrayBuffer();
      })
      .then(buffer => {
        protobuf.load('gtfs-realtime.proto', (err, root) => {
          if (err) throw err;
  
          const FeedMessage = root.lookupType('transit_realtime.FeedMessage');
          const message = FeedMessage.decode(new Uint8Array(buffer));
  
          const stationId = config.stationIdBase;
          const inboundRegex = new RegExp(`^${stationId}S$`);
          const outboundRegex = new RegExp(`^${stationId}N$`);
          const baseRegex = new RegExp(`^${stationId}[NS]$`);
  
          // Filter relevant entities
          const relevantEntities = message.entity.filter(entity => {
            if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) return false;
            return entity.tripUpdate.stopTimeUpdate.some(stu => baseRegex.test(stu.stopId));
          });
  
          let inboundAll = [];
          let outboundAll = [];
  
          relevantEntities.forEach(entity => {
            const updates = entity.tripUpdate.stopTimeUpdate || [];
            inboundAll.push(...updates.filter(stu => inboundRegex.test(stu.stopId)));
            outboundAll.push(...updates.filter(stu => outboundRegex.test(stu.stopId)));
          });
  
          // Sort by arrival time ascending
          inboundAll.sort((a, b) => getArrivalTime(a) - getArrivalTime(b));
          outboundAll.sort((a, b) => getArrivalTime(a) - getArrivalTime(b));
  
          // 1) Filter out trains below hideThreshold
          inboundAll = filterBelowThreshold(inboundAll, config.hideThreshold);
          outboundAll = filterBelowThreshold(outboundAll, config.hideThreshold);
  
          // 2) Take up to 3 arrivals
          inboundAll = inboundAll.slice(0, 3);
          outboundAll = outboundAll.slice(0, 3);
  
          // Clear old data but keep headings
          inboundContainer.innerHTML = '<h3>Inbound (Manhattan-bound)</h3>';
          outboundContainer.innerHTML = '<h3>Outbound (Queens-bound)</h3>';
  
          // Append inbound
          inboundAll.forEach(update => {
            appendUpdateInfo(inboundContainer, update, 'Inbound', config);
          });
  
          // Append outbound
          outboundAll.forEach(update => {
            appendUpdateInfo(outboundContainer, update, 'Outbound', config);
          });
  
          // Now update the "leave" messages in the top boxes
          if (config.lineName.includes('7 Train')) {
            // "Catching the 7" - using a 10-min walk
            updateLeaveMessage(inboundAll, 10, 'leave-message');
          } 
          else if (config.lineName.includes('R Train')) {
            // "Getting to Astoria" - using 16-min walk from your example
            updateLeaveMessage(inboundAll, 16, 'leave-message-astoria');
          }
          else if (config.lineName.includes('E Train')) {
            // E Train in the final box, 10-min walk
            updateLeaveMessage(inboundAll, 16, 'leave-message-e');
          }
          else if (config.lineName.includes('F Train')) {
            // F Train in the final box, 10-min walk
            updateLeaveMessage(inboundAll, 16, 'leave-message-f');
          }
        });
      })
      .catch(error => {
        console.error(`Error fetching data for ${config.lineName}`, error);
        inboundContainer.innerHTML = `<p style="color:red;">Error fetching data for ${config.lineName}.</p>`;
        outboundContainer.innerHTML = '';
      });
  }
  
  /** 
   * filterBelowThreshold: remove updates under a certain minutes threshold 
   */
  function filterBelowThreshold(updates, thresholdMin) {
    const now = Date.now();
    return updates.filter(stu => {
      const arrMs = getArrivalTime(stu);
      const diffMin = (arrMs - now) / 60000;
      return diffMin >= thresholdMin;
    });
  }
  
  /**
   * Create <p> for inbound/outbound listing in linesContainer
   */
  function appendUpdateInfo(container, update, directionLabel, config) {
    const arrivalSec = update.arrival?.time || 0;
    const departureSec = update.departure?.time || 0;
  
    const p = document.createElement('p');
    p.classList.add('train-update');
  
    // Store arrival/departure in data attrs if you want real-time updates
    p.dataset.arrivalMs = arrivalSec * 1000;
    p.dataset.departureMs = departureSec * 1000;
    p.dataset.direction = directionLabel;
  
    // For color/hiding logic (optional)
    p.dataset.hideThreshold = config.hideThreshold || 8;
  
    p.textContent = formatCountdownMessage(arrivalSec, directionLabel);
  
    container.appendChild(p);
    // Track it so we can re-calc in updateAllCountdowns
    allTrainUpdates.push(p);
  }
  
  /************************************
   * Leave Message Function
   ************************************/
  
  /**
   * updateLeaveMessage: sets text in a specific container (e.g. "leave-message-e")
   * telling the user how many minutes until they must leave, subtracting walkTime.
   */
  function updateLeaveMessage(inboundUpdates, walkTime, containerId) {
    const msgEl = document.getElementById(containerId);
    if (!msgEl) return; // If that ID doesn't exist in HTML, do nothing
  
    // If no inbound trains
    if (inboundUpdates.length === 0) {
      msgEl.textContent = "No inbound trains available.";
      msgEl.style.color = "#ff0000";
      return;
    }
  
    const now = Date.now();
    const arrivalMs = getArrivalTime(inboundUpdates[0]);
    const diffMin = (arrivalMs - now) / 60000; // total minutes from now
    const leaveMin = diffMin - walkTime;
  
    if (leaveMin <= 0) {
      msgEl.textContent = "If you run, you might make it!";
      msgEl.style.color = "#ff0000";
    } else {
      const left = Math.ceil(leaveMin);
      msgEl.textContent = `Leave in the next ${left} minute${left === 1 ? '' : 's'}`;
      msgEl.style.color = "#4ade80";
    }
  }
  
  /************************************
   * Update Countdown Per Second
   ************************************/
  function updateAllCountdowns() {
    // Re-check each <p> if you want color/hide changes in real time
    allTrainUpdates.forEach(p => {
      const hideMin = parseFloat(p.dataset.hideThreshold) || 8;
      const arrivalMin = getSecondsUntil(p.dataset.arrivalMs) / 60;
  
      // Hide if arrival < hideMin
      if (arrivalMin < hideMin) {
        p.style.display = 'none';
        return;
      }
      p.style.display = 'block';
  
      // For now, just re-calc the "Arrives in X" message
      // If you want color logic, do it here
      const direction = p.dataset.direction || 'Train';
      const arrivalSec = getSecondsUntil(p.dataset.arrivalMs);
      p.textContent = formatCountdownString(direction, arrivalSec);
    });
  }
  
  /************************************
   * Utilities
   ************************************/
  
  /** getArrivalTime returns the arrival time in ms */
  function getArrivalTime(stu) {
    if (stu.arrival?.time) {
      return stu.arrival.time * 1000;
    }
    if (stu.departure?.time) {
      return stu.departure.time * 1000;
    }
    return Infinity;
  }
  
  /** getSecondsUntil returns how many seconds from now until msString */
  function getSecondsUntil(msString) {
    const ms = parseInt(msString, 10);
    if (!ms) return Infinity;
    return (ms - Date.now()) / 1000;
  }
  
  /** formatCountdownMessage for inbound/outbound listing */
  function formatCountdownMessage(arrivalSec, direction) {
    const secUntil = arrivalSec - Math.floor(Date.now() / 1000);
    const arrivalStr = formatTimeString(secUntil, 'Arriving now');
    return `${direction}: Arrives in ${arrivalStr}`;
  }
  
  /** formatTimeString: convert seconds -> "Mm Ss" or fallback */
  function formatTimeString(seconds, fallbackIfZero) {
    if (!isFinite(seconds)) return 'N/A';
    if (seconds <= 0) return fallbackIfZero;
  
    const s = Math.floor(seconds);
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}m ${sec}s`;
  }
  
  /** formatCountdownString: used in updateAllCountdowns for real-time updates */
  function formatCountdownString(direction, arrivalSec) {
    const arrivalStr = formatTimeString(arrivalSec, 'Arriving now');
    return `${direction}: Arrives in ${arrivalStr}`;
  }
  