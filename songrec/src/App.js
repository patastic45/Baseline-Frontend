import React, { useState, useEffect, useCallback, useRef } from 'react';

// --- React Bootstrap Imports ---
import Button from 'react-bootstrap/Button';
import Form from 'react-bootstrap/Form';
import Card from 'react-bootstrap/Card';
import Alert from 'react-bootstrap/Alert';
import InputGroup from 'react-bootstrap/InputGroup';

// --- Lucide Icons ---
import { AlertCircle, Music, MapPin, Loader2, MessageSquare, LogOut } from 'lucide-react'; // Added LogOut

// --- Constants ---
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:8000';
const SPOTIFY_CLIENT_ID = process.env.REACT_APP_SPOTIFY_CLIENT_ID || 'YOUR_SPOTIFY_CLIENT_ID';
const GOOGLE_PLACES_API_KEY = process.env.REACT_APP_GOOGLE_PLACES_API_KEY || 'YOUR_GOOGLE_PLACES_API_KEY';
const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const MAX_DESCRIPTION_LENGTH = 500;

const MoodifyApp = () => {
    // --- State Variables ---
    const [locationInput, setLocationInput] = useState('');
    const [playlistUrl, setPlaylistUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [googlePlaceId, setGooglePlaceId] = useState('');
    const [latitude, setLatitude] = useState(null);
    const [longitude, setLongitude] = useState(null);
    const [spotifyPlayer, setSpotifyPlayer] = useState(null);
    const [spotifyToken, setSpotifyToken] = useState(null);
    const [deviceId, setDeviceId] = useState(null);
    const [apiKeyError, setApiKeyError] = useState(false);
    const [isGoogleMapsApiLoaded, setIsGoogleMapsApiLoaded] = useState(false);
    const [dynamicSituation, setDynamicSituation] = useState('');
    const [userDescription, setUserDescription] = useState('');

    // --- Refs ---
    const mapRef = useRef(null);
    const autocompleteInstanceRef = useRef(null);

    // --- Options for Dynamic Situation (Mandatory) ---
    const dynamicSituationOptions = [
        { value: '', label: '-- Select a Vibe (Required) --', disabled: true },
        { value: 'bright', label: 'Bright / Positive' },
        { value: 'dark', label: 'Dark / Negative' },
        { value: 'tense', label: 'Tense / High Energy' },
        { value: 'relaxed', label: 'Relaxed / Low Energy' },
    ];


    /**
     * Handles changes to the location input field.
     */
    const handleLocationInputChange = (event) => {
        setLocationInput(event.target.value);
        setError('');
        setApiKeyError(false);
        if (googlePlaceId) {
            setGooglePlaceId('');
            setLatitude(null);
            setLongitude(null);
        }
    };

    // --- Spotify Functions (Memoized with useCallback) ---

    /**
     * Redirects the user to the backend endpoint for Spotify authentication.
     */
    const handleSpotifyLogin = useCallback(() => {
        window.location.href = `${BACKEND_URL}/login`;
    }, []);

    /**
     * Fetches the Spotify access token from the backend.
     */
    const getSpotifyAccessToken = useCallback(async () => {
        console.log("[Spotify] Attempting to get token...");
        try {
            const response = await fetch(`${BACKEND_URL}/spotify_token`, { method: 'GET', credentials: 'include' });
            if (!response.ok) {
                let errorMsg = 'Failed to get Spotify access token.';
                try { const errorData = await response.json(); errorMsg = errorData.error || errorMsg; }
                catch (parseError) { errorMsg = `${errorMsg} Status: ${response.status}`; }
                throw new Error(errorMsg);
            }
            const data = await response.json();
            console.log("[Spotify] Received token data from backend:", data);
            if (data.access_token) {
                console.log("[Spotify] Setting token state.");
                setSpotifyToken(data.access_token); setError(''); return data.access_token;
            }
            else { throw new Error("Access token not found in backend response."); }
        } catch (error) {
            setError(`Error getting Spotify token: ${error.message}`); console.error('[Spotify] Token Fetch Error:', error);
            setSpotifyToken(null); return null;
        } finally {
             console.log("[Spotify] getSpotifyAccessToken finally block.");
             // setLoading(false); // Let calling effect manage loading
        }
    }, []);

    /**
     * Initializes the Spotify Web Playback SDK.
     */
    const initializeSpotifyPlayer = useCallback(async (token) => {
        if (!token) { console.warn("[Spotify Player] No token for player init."); return Promise.reject(new Error("Token missing")); }
        if (spotifyPlayer) { console.log("[Spotify Player] Player already initialized."); return Promise.resolve(true); }
        console.log("[Spotify Player] Initializing Spotify player process...");

        return new Promise((resolve, reject) => {
            const setupPlayer = () => {
                try {
                    if (!window.Spotify) { reject(new Error("Spotify SDK not loaded.")); return; }
                    console.log("[Spotify Player] Setting up new window.Spotify.Player instance.");
                    const player = new window.Spotify.Player({ name: 'Placeify Web Player', getOAuthToken: cb => cb(token), volume: 0.5 });

                    player.addListener('ready', ({ device_id }) => { console.log('[Spotify Player] Player ready:', device_id); setDeviceId(device_id); setSpotifyPlayer(player); setError(''); resolve(true); });
                    player.addListener('not_ready', ({ device_id }) => console.warn('[Spotify Player] Device not ready:', device_id));
                    player.addListener('initialization_error', ({ message }) => { setError(`Player init error: ${message}`); reject(new Error(message)); });
                    player.addListener('authentication_error', ({ message }) => { setError(`Auth error: ${message}. Login again.`); setSpotifyToken(null); reject(new Error(message)); });
                    player.addListener('account_error', ({ message }) => { setError(`Account error: ${message}. Premium?`); reject(new Error(message)); });
                    player.addListener('playback_error', ({ message }) => { setError(`Playback error: ${message}`); });

                    console.log("[Spotify Player] Connecting Spotify Player...");
                    player.connect().then(success => { if (!success) { setError('Failed connect player.'); reject(new Error('Connect failed.')); } else { console.log('[Spotify Player] Connect() successful.'); } }).catch(reject);
                } catch (e) { setError(`Setup error: ${e.message}`); reject(e); }
            };

            console.log("[Spotify Player] Assigning function to window.onSpotifyWebPlaybackSDKReady");
            window.onSpotifyWebPlaybackSDKReady = setupPlayer;

            const scriptTag = document.getElementById('spotify-player-script');
            if (!scriptTag) {
                 console.log("[Spotify Player] Appending Spotify script tag...");
                 const script = document.createElement('script'); script.id = 'spotify-player-script'; script.src = SPOTIFY_SDK_URL; script.async = true;
                 script.onerror = () => { setError('Failed loading SDK.'); if (window.onSpotifyWebPlaybackSDKReady === setupPlayer) delete window.onSpotifyWebPlaybackSDKReady; reject(new Error('SDK script load failed.')); };
                 document.body.appendChild(script);
            } else {
                 console.log("[Spotify Player] Spotify script tag found.");
                 if (window.Spotify) { console.log("[Spotify Player] window.Spotify exists, calling setupPlayer."); setupPlayer(); }
                 else { console.log("[Spotify Player] Script exists but SDK not ready, waiting for callback."); }
            }
        });
    }, [spotifyPlayer]);

    /**
     * Uses the Spotify Web API to start playback of a given playlist URI on the active device.
     */
    const startPlaylistPlayback = useCallback(async (playlistUri) => {
        if (!deviceId) { setError('Spotify player not ready (no device ID).'); return; }
        if (!spotifyToken) { setError('Spotify token missing.'); return; }
        const playlistIdMatch = playlistUri.match(/playlist[/:]([a-zA-Z0-9]+)/);
        const playlistId = playlistIdMatch ? playlistIdMatch[1] : null;
        if (!playlistId) { setError('Invalid Spotify playlist URL.'); return; }
        const spotifyPlaylistUri = `spotify:playlist:${playlistId}`;
        console.log(`[Spotify Playback] Attempting play: ${spotifyPlaylistUri} on ${deviceId}`);
        try {
            const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${spotifyToken}` },
                body: JSON.stringify({ context_uri: spotifyPlaylistUri })
            });
            if (!response.ok) {
                let errorDetails = await response.text(); try { const json = JSON.parse(errorDetails); errorDetails = json.error?.message || errorDetails; } catch(e){}
                if (response.status === 404) throw new Error(`Device not found (${response.status}): ${errorDetails}`);
                if (response.status === 403) throw new Error(`Playback forbidden (${response.status}): ${errorDetails}`);
                throw new Error(`Playback failed (${response.status}): ${errorDetails}`);
            }
            console.log('[Spotify Playback] Playback command sent.');
        } catch (error) { console.error('[Spotify Playback] API Error:', error); setError(`Playback error: ${error.message}`); }
    }, [deviceId, spotifyToken]);


    // --- Google Places Functions ---

    // Effect 1: Load the Google Maps JavaScript API script
    useEffect(() => {
        console.log("[Maps Effect Load Script] Running effect.");
        if (!GOOGLE_PLACES_API_KEY || GOOGLE_PLACES_API_KEY === 'YOUR_GOOGLE_PLACES_API_KEY') {
            console.error("[Maps Effect Load Script] API Key missing.");
            setError("Google API Key missing."); setApiKeyError(true); return; }
        if (window.google?.maps) {
            console.log("[Maps Effect Load Script] Maps API already loaded.");
            if (!isGoogleMapsApiLoaded) setIsGoogleMapsApiLoaded(true); return; }
        if (document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')) {
             console.log("[Maps Effect Load Script] Maps script tag exists, waiting.");
             if (!window.googleMapsApiLoaded) { window.googleMapsApiLoaded = () => { console.log("[Maps Effect Load Script] API loaded via existing script callback."); setIsGoogleMapsApiLoaded(true); delete window.googleMapsApiLoaded; }; }
             return;
        }
        console.log("[Maps Effect Load Script] Injecting Google Maps script...");
        window.googleMapsApiLoaded = () => { console.log("[Maps Effect Load Script] API loaded via injected script callback."); setIsGoogleMapsApiLoaded(true); delete window.googleMapsApiLoaded; };
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_API_KEY}&libraries=places&callback=googleMapsApiLoaded`;
        script.async = true; script.defer = true;
        script.onerror = () => { console.error("[Maps Effect Load Script] Failed loading Maps API script."); setError("Failed loading Maps API."); setApiKeyError(true); if (window.googleMapsApiLoaded) delete window.googleMapsApiLoaded; };
        document.head.appendChild(script);
        return () => { if (window.googleMapsApiLoaded) {console.log("[Maps Effect Load Script] Cleaning up callback."); delete window.googleMapsApiLoaded;} };
    }, []);

    /**
     * Function to initialize the Google Map and Places Autocomplete instances.
     */
    const initAutocomplete = useCallback(() => {
        console.log('[initAutocomplete] Function called.');
        const inputElement = document.getElementById('location-input');
        if (!isGoogleMapsApiLoaded || !mapRef.current || !inputElement) {
            console.warn(`[initAutocomplete] Pre-checks failed: API=${isGoogleMapsApiLoaded}, mapRef=${!!mapRef.current}, input=${!!inputElement}`);
            return null;
        }
        if (!window.google?.maps?.places) {
            console.error("[initAutocomplete] window.google.maps.places not available!");
            setError("Error init Maps. Refresh?"); setIsGoogleMapsApiLoaded(false); return null;
        }
        try {
            console.log("[initAutocomplete] Initializing Google Autocomplete/Map...");
            const autocomplete = new window.google.maps.places.Autocomplete(inputElement, { types: ['establishment', 'geocode'], fields: ["place_id", "geometry", "name", "formatted_address"] });
            autocompleteInstanceRef.current = autocomplete;
            const initialCenter = (latitude && longitude) ? { lat: latitude, lng: longitude } : { lat: 37.7749, lng: -122.4194 };
            const initialZoom = (latitude && longitude) ? 15 : 10;
            console.log('[initAutocomplete] Attempting map creation with element:', mapRef.current);
            const map = new window.google.maps.Map(mapRef.current, { center: initialCenter, zoom: initialZoom, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
            console.log('[initAutocomplete] Map instance created:', map);
            const marker = new window.google.maps.Marker({ map: map, position: (latitude && longitude) ? initialCenter : null });
            if (window.google?.maps?.event) { window.google.maps.event.clearInstanceListeners(autocomplete); }
            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();
                console.log("[initAutocomplete] Place selected:", place);
                if (place?.place_id) {
                    setGooglePlaceId(place.place_id); setLocationInput(place.formatted_address || place.name || ''); setError('');
                    if (place.geometry?.location) {
                        const loc = place.geometry.location; const lat = loc.lat(); const lng = loc.lng();
                        setLatitude(lat); setLongitude(lng); const newCenter = { lat, lng };
                        map.setCenter(newCenter); map.setZoom(16); marker.setPosition(newCenter); if (!marker.getMap()) marker.setMap(map);
                    } else { setLatitude(null); setLongitude(null); marker.setMap(null); }
                } else { setError('Select valid location.'); setGooglePlaceId(''); setLatitude(null); setLongitude(null); marker.setMap(null); }
            });
            console.log("[initAutocomplete] Google Maps components initialized successfully."); return autocomplete;
        } catch (e) {
            console.error("[initAutocomplete] Maps init error:", e);
            setError(`Maps init error: ${e.message}.`); setApiKeyError(true); return null;
        }
    }, [isGoogleMapsApiLoaded, latitude, longitude]);

    /** Effect to initialize Google Maps components when ready and form is visible */
    useEffect(() => {
        console.log('[Effect Maps Init] Running effect. API Loaded:', isGoogleMapsApiLoaded, 'mapRef.current:', mapRef.current, 'playlistUrl:', playlistUrl);
        if (isGoogleMapsApiLoaded && mapRef.current && !playlistUrl) {
            console.log('[Effect Maps Init] Conditions met, calling initAutocomplete.');
            initAutocomplete();
        } else {
            console.log(`[Effect Maps Init] Conditions NOT met: API Loaded=${isGoogleMapsApiLoaded}, mapRef=${!!mapRef.current}, playlistUrl=${playlistUrl}`);
        }
        return () => { const instance = autocompleteInstanceRef.current; if (instance && window.google?.maps?.event) {console.log("[Effect Maps Init] Cleaning up Autocomplete listeners."); window.google.maps.event.clearInstanceListeners(instance);} };
    }, [isGoogleMapsApiLoaded, initAutocomplete, playlistUrl]); // Added playlistUrl dependency

    // --- Core Application Logic Effects ---

    /** Effect to check for Spotify Auth Code/Error in URL on mount */
    useEffect(() => {
        console.log("[Effect Auth Check] Running effect.");
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code'); const errorParam = urlParams.get('error');
        if (errorParam) { console.error("[Effect Auth Check] Error in URL:", errorParam); setError(`Auth failed: ${errorParam}.`); window.history.replaceState({}, '', window.location.pathname); }
        else if (code) {
             console.log("[Effect Auth Check] Code found in URL, fetching token...");
             window.history.replaceState({}, '', window.location.pathname);
             // setLoading(true); // Don't use main loading for token fetch
             setError('');
             getSpotifyAccessToken(); // Let getSpotifyAccessToken handle its own loading if needed
        }
        else { console.log("[Effect Auth Check] No code or error in URL."); }
    }, [getSpotifyAccessToken]);

    /** Effect to initialize Spotify Player when token is available */
    useEffect(() => {
        console.log('[Effect Player Init] Running effect. Token:', !!spotifyToken, 'Player:', !!spotifyPlayer);
        console.log('[Effect Player Init] Map Ref before player init:', mapRef.current);
        if (spotifyToken && !spotifyPlayer) {
            console.log("[Effect Player Init] Conditions met, initializing player...");
            // setLoading(true); // Don't use main loading for player init
            initializeSpotifyPlayer(spotifyToken)
                .then(() => console.log(`[Effect Player Init] Player Init Successful (ready listener confirms)`))
                .catch(err => console.error("[Effect Player Init] Player Init Failed:", err))
                .finally(() => {
                    // setLoading(false); // Don't use main loading for player init
                    console.log('[Effect Player Init] Player init attempt finished.');
                    console.log('[Effect Player Init] Map Ref AFTER player init attempt:', mapRef.current);
                });
        }
        // Cleanup function to disconnect player
        return () => {
            const p = spotifyPlayer;
            if (p) {
                console.log("[Effect Player Init] Disconnecting player on cleanup.");
                p.disconnect();
                setSpotifyPlayer(null);
                setDeviceId(null);
            }
        };
    }, [spotifyToken, initializeSpotifyPlayer, spotifyPlayer]);


    // --- Form Submission Handler ---
    const handleSubmit = async (event) => {
        event.preventDefault();
        console.log("[handleSubmit] Form submitted.");

        // --- Validation ---
        let formIsValid = true; let currentError = '';
        if (!locationInput.trim() || !googlePlaceId) { currentError = 'Select a valid location.'; formIsValid = false; }
        else if (latitude === null || longitude === null) { currentError = 'Could not get coordinates.'; formIsValid = false; }
        else if (!dynamicSituation) { currentError = 'Select a vibe/situation.'; formIsValid = false; }
        else if (userDescription.length > MAX_DESCRIPTION_LENGTH) { currentError = `Description too long (max ${MAX_DESCRIPTION_LENGTH}).`; formIsValid = false; }
        else if (!spotifyToken) { currentError = 'Login with Spotify first.'; formIsValid = false; handleSpotifyLogin(); }
        else if (!deviceId) { currentError = 'Spotify player not ready.'; formIsValid = false; }
        else if (apiKeyError) { currentError = 'Google API Key error.'; formIsValid = false; }

        setError(currentError);
        if (!formIsValid) { console.log("[handleSubmit] Validation failed:", currentError); return; }

        // --- Start Process ---
        console.log("[handleSubmit] Validation passed. Setting loading state.");
        setLoading(true); // Use loading state HERE for form submission
        setPlaylistUrl('');

        try {
            // Prepare Payload
            const payload = {
                place_id: googlePlaceId, latitude: latitude, longitude: longitude,
                dynamicSituation: dynamicSituation,
                userDescription: userDescription.trim()
            };
            console.log(`[handleSubmit] Sending playlist request:`, payload);

            // API Call
            const response = await fetch(`${BACKEND_URL}/playlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });

            // Handle Response
            if (!response.ok) {
                 let errorMsg = 'Playlist fetch failed.'; try { const d = await response.json(); errorMsg = d.error || `${errorMsg} Status: ${response.status}`; } catch(e){} throw new Error(errorMsg);
            }
            const data = await response.json();
            if (data.playlist_url) { console.log("[handleSubmit] Playlist URL received:", data.playlist_url); setPlaylistUrl(data.playlist_url); await startPlaylistPlayback(data.playlist_url); }
            else if (data.message) { console.log("[handleSubmit] Backend message:", data.message); setError(data.message); setPlaylistUrl(''); }
            else { throw new Error('Playlist URL missing.'); }
        } catch (error) { console.error("[handleSubmit] Error during playlist fetch:", error); setError(`Playlist error: ${error.message}`); setPlaylistUrl(''); }
        finally { console.log("[handleSubmit] Setting loading state to false."); setLoading(false); }
    };

    // *** ADDED Logout Handler ***
    const handleLogout = useCallback(() => {
        console.log("[Logout] Logging out...");
        // Disconnect player if it exists
        if (spotifyPlayer) {
            console.log("[Logout] Disconnecting player.");
            spotifyPlayer.disconnect();
        }
        // Clear all relevant state
        setSpotifyToken(null);
        setSpotifyPlayer(null);
        setDeviceId(null);
        setPlaylistUrl(''); // Clear playlist if shown
        setError(''); // Clear any errors
        // Optionally reset form fields too
        // setLocationInput('');
        // setGooglePlaceId('');
        // setLatitude(null);
        // setLongitude(null);
        // setDynamicSituation('');
        // setUserDescription('');

        // Optional: Call backend logout endpoint if you have one
        // fetch(`${BACKEND_URL}/logout`, { method: 'POST', credentials: 'include' });

        console.log("[Logout] Frontend state cleared.");
    }, [spotifyPlayer]); // Dependency: spotifyPlayer instance


    // --- UI Rendering Logic ---
    const renderContent = () => {
        // 1. Loading State (Only show for form submission)
        if (loading) {
             return ( <div className="text-center p-5"><Loader2 className="animate-spin h-12 w-12 text-primary mx-auto mb-3" /><p className="text-muted">Creating Playlist...</p></div> );
        }

        // 2. Error State (Show only if not loading and no playlist displayed)
        const displayError = error || (apiKeyError ? "Google Maps API Key issue. Check config." : "");
        const shouldShowError = displayError && !playlistUrl && !loading;

        // 3. Playlist Ready State (Display Spotify Embed)
        if (playlistUrl) {
            const playlistIdMatch = playlistUrl.match(/playlist[/:]([a-zA-Z0-9]+)/);
            const playlistId = playlistIdMatch ? playlistIdMatch[1] : null;
            return (
                <Card className="max-w-lg mx-auto shadow-lg border-light">
                    <Card.Header as="h5" className="bg-success text-white d-flex justify-content-between align-items-center">
                        <span><Music className="inline-block mr-2" /> Playlist Ready!</span>
                         {/* Logout Button when playlist is shown */}
                         {spotifyToken && (
                            <Button variant="outline-light" size="sm" onClick={handleLogout} title="Logout">
                                <LogOut size={16} />
                            </Button>
                         )}
                    </Card.Header>
                    <Card.Body>
                        {playlistId ? (
                            <iframe title="Spotify Playlist Embed" style={{ borderRadius: '12px', border: 'none', width: '100%', minHeight: '380px' }} src={`https://open.spotify.com/embed/playlist/${playlistId}?utm_source=generator&theme=0`} allowFullScreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>
                        ) : ( <Alert variant="warning">Could not display embed.</Alert> )}
                         <Button variant="outline-secondary" onClick={() => { setPlaylistUrl(''); setLocationInput(''); setGooglePlaceId(''); setDynamicSituation(''); setUserDescription(''); setError(''); }} className="mt-3 w-100"> Create Another </Button>
                    </Card.Body>
                </Card>
            );
        }

        // 4. Default State: Show the Input Form
        return (
            <Card className="w-full max-w-lg mx-auto shadow-md border-light">
                <Card.Header as="h5" className="bg-primary text-white d-flex justify-content-between align-items-center">
                    <span>Find Your Vibe</span>
                    {/* Logout Button when form is shown */}
                    {spotifyToken && (
                        <Button variant="outline-light" size="sm" onClick={handleLogout} title="Logout">
                            <LogOut size={16} />
                        </Button>
                     )}
                </Card.Header>
                <Card.Body>
                     {/* Display Error Alert first if needed */}
                     {shouldShowError && (
                         <Alert variant="danger" onClose={() => setError('')} dismissible className="mb-3">
                             <Alert.Heading><AlertCircle className="inline-block mr-1 h-5 w-5" /> Error</Alert.Heading>
                             <p>{displayError}</p>
                             {error.includes("log in") && !spotifyToken && ( <Button variant="outline-danger" size="sm" onClick={handleSpotifyLogin}>Retry Login</Button> )}
                         </Alert>
                     )}

                    {/* API Key Warnings */}
                    {(GOOGLE_PLACES_API_KEY === 'YOUR_GOOGLE_PLACES_API_KEY') && (<Alert variant="warning" className="text-sm py-1 px-2 mb-3"><AlertCircle size={16} className="inline mr-1"/> Google API Key missing!</Alert>)}
                    {(SPOTIFY_CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID') && (<Alert variant="warning" className="text-sm py-1 px-2 mb-3"><AlertCircle size={16} className="inline mr-1"/> Spotify Client ID missing!</Alert>)}

                    {/* Form: Added noValidate */}
                    <Form onSubmit={handleSubmit} noValidate>
                        {/* Location Input: Added position-relative and isInvalid/Feedback */}
                        <Form.Group className="mb-3 position-relative">
                            <Form.Label htmlFor="location-input"> <MapPin className="inline-block mr-1 h-4 w-4" /> Location </Form.Label>
                            <Form.Control id="location-input" type="text" placeholder="Search for a place..." value={locationInput} onChange={handleLocationInputChange} disabled={apiKeyError || loading} required isInvalid={!!error && (error.includes('location') || error.includes('coordinates'))} />
                            <Form.Control.Feedback type="invalid"> {error.includes('location') || error.includes('coordinates') ? error : 'Please select a valid location.'} </Form.Control.Feedback>
                            <Form.Text muted> e.g., "Cafe Intermezzo", "Piedmont Park" </Form.Text>
                        </Form.Group>

                        {/* Map Container */}
                        <div ref={mapRef} style={{ width: '100%', height: '250px', marginBottom: '1rem', borderRadius: '8px', backgroundColor: '#e9ecef', border: apiKeyError ? '2px solid #dc3545' : '1px solid #dee2e6', position: 'relative', overflow: 'hidden' }} aria-label="Map">
                           {apiKeyError && ( <div className="d-flex align-items-center justify-content-center h-100 text-danger p-3 text-center small">Map disabled: API Key error.</div> )}
                           {!isGoogleMapsApiLoaded && !apiKeyError && ( <div className="d-flex align-items-center justify-content-center h-100 text-muted p-3 text-center small"><Loader2 className="animate-spin h-5 w-5 mr-2" /> Loading Map...</div> )}
                        </div>

                        {/* Dynamic Situation Dropdown (Required) */}
                        <Form.Group className="mb-3 position-relative">
                            <Form.Label htmlFor="dynamic-situation-select"><Music className="inline-block mr-1 h-4 w-4" /> Vibe/Situation <span className="text-danger">*</span></Form.Label>
                            <Form.Select id="dynamic-situation-select" value={dynamicSituation} onChange={(e) => { setDynamicSituation(e.target.value); setError(''); }} disabled={loading || apiKeyError || !spotifyToken} required aria-label="Select vibe" isInvalid={!!error && error.includes('select a vibe')} >
                                {dynamicSituationOptions.map(option => ( <option key={option.value} value={option.value} disabled={option.disabled}> {option.label} </option> ))}
                            </Form.Select>
                            <Form.Control.Feedback type="invalid">{error.includes('select a vibe') ? error : 'Please select a vibe.'}</Form.Control.Feedback>
                        </Form.Group>

                        {/* User Description Textarea */}
                        <Form.Group className="mb-3 position-relative">
                            <Form.Label htmlFor="user-description"><MessageSquare className="inline-block mr-1 h-4 w-4" /> Describe Scene/Mood (Optional)</Form.Label>
                            <Form.Control
                                as="textarea"
                                id="user-description"
                                rows={3}
                                placeholder="e.g., 'Rainy evening by the fireplace', 'Busy Monday morning coffee shop'"
                                value={userDescription}
                                onChange={(e) => setUserDescription(e.target.value)}
                                maxLength={MAX_DESCRIPTION_LENGTH}
                                disabled={loading || apiKeyError || !spotifyToken}
                                aria-describedby="description-help-text"
                                isInvalid={userDescription.length > MAX_DESCRIPTION_LENGTH}
                            />
                             <Form.Text id="description-help-text" className="d-flex justify-content-between">
                                <span>Add details about atmosphere/feeling.</span>
                                <span className={userDescription.length > MAX_DESCRIPTION_LENGTH ? 'text-danger fw-bold' : 'text-muted'}>
                                     {userDescription.length}/{MAX_DESCRIPTION_LENGTH}
                                </span>
                            </Form.Text>
                             <Form.Control.Feedback type="invalid">Description is too long.</Form.Control.Feedback>
                        </Form.Group>


                         {/* Spotify Login Button */}
                        {!spotifyToken && ( <Button variant="success" className="w-100 mb-3 d-flex align-items-center justify-content-center" onClick={handleSpotifyLogin} disabled={loading}> <svg role="img" height="20" width="20" aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="mr-2"><path d="M8 0C3.58 0 0 3.58 0 8c0 4.42 3.58 8 8 8s8-3.58 8-8c0-4.42-3.58-8-8-8zm4.74 11.54c-.1.15-.3.2-.45.1l-2.5-1.54c-.15-.1-.2-.3-.1-.45.1-.15.3-.2.45-.1l2.5 1.54c.15.1.2.3.1.45zm.94-1.94c-.15.2-.4.25-.6.1l-3.1-1.9c-.2-.1-.25-.4-.1-.6.2-.15.4-.25.6-.1l3.1 1.9c.2.1.25.4.1.6zm.14-2.34c-.18.22-.5.28-.72.1L5.4 5.12c-.22-.1-.3-.4-.1-.62.17-.22.5-.27.72-.1l4.8 2.98c.22.14.3.43.1.66z"></path></svg> Login with Spotify </Button> )}

                         {/* Submit Button */}
                        <Button variant="primary" type="submit" className="w-100 fw-bold" disabled={
                                loading || apiKeyError || !spotifyToken || !googlePlaceId ||
                                !dynamicSituation || // Now required
                                userDescription.length > MAX_DESCRIPTION_LENGTH // Disable if desc too long
                            }>
                           Get Your Playlist
                        </Button>
                    </Form>

                    {/* Informational Messages */}
                    {spotifyToken && !deviceId && !error && !loading && ( <p className="mt-3 text-sm text-info text-center d-flex align-items-center justify-content-center"> <Loader2 className="animate-spin h-4 w-4 mr-2" /> Waiting for Spotify Player... </p> )}
                    {!spotifyToken && !loading && ( <p className="mt-3 text-sm text-muted text-center"> Login with Spotify to create playlists. </p> )}
                    {/* Removed the "Logged in. Player ready" message to avoid clutter with logout button */}
                    {/* {spotifyToken && deviceId && !loading && !error && !playlistUrl && ( <p className="mt-3 text-sm text-success text-center"> Logged in. Spotify Player ready. </p> )} */}
                </Card.Body>
            </Card>
        );
    }; // End renderContent

    // --- Component Return ---
    return (
        <div className="min-vh-100 bg-light d-flex align-items-center justify-content-center p-3 p-md-4">
            <div className="w-100" style={{ maxWidth: '600px' }}>
                <h1 className="display-5 fw-bold text-dark mb-4 text-center"> Placeify 🎧📍 </h1>
                {renderContent()}
                 <footer className="text-center text-muted mt-4"> <small>Powered by Spotify & Google Places APIs</small> </footer>
            </div>
        </div>
    );
};

export default MoodifyApp;
