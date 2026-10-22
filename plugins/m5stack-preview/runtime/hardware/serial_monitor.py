"""Bounded USB diagnostics; raw app logs/audio are never returned."""
import json,sys,time,serial
port,seconds,command=sys.argv[1],int(sys.argv[2]),sys.argv[3]
events=[];buffer=b'';last=0
s=serial.Serial(exclusive=True);s.port=port;s.baudrate=115200;s.timeout=.15;s.dtr=True;s.rts=False;s.open()
end=time.monotonic()+seconds
allowed={'event','profile','build','ready','board','width','height','uptime_ms','reset_reason','app_input_us','audio_start_us','heap','psram','physical_inputs','automated_inputs','speaker_frames','speaker_playing','mic_requested','mic_active','mic_frames','mic_rms','mic_errors','audio_duplex','error','physical','accepted','x','y','duration','kind','end_x','end_y','speaker_volume','physical_taps','physical_holds','physical_swipes','physical_strip','physical_power_clicks','physical_power_holds','physical_button_clicks','physical_button_holds','physical_secondary_clicks','physical_secondary_holds','physical_shakes','physical_tilts','imu_samples','imu_invalid','accel_x','accel_y','accel_z','tilt_degrees','networks_seen','configured_network_found','name_case_mismatch','channel','rssi','auth_mode','wifi_reason','http_transport_code','request_ms','tls_code','time_epoch','connected','configured','busy','requests','completed','http_status','response_bytes'}
try:
 s.write((command+'\n').encode())
 while time.monotonic()<end:
  if time.monotonic()-last>1:s.write(b'STATUS\n');last=time.monotonic()
  buffer+=s.read(4096)
  if len(buffer)>65536:buffer=b''
  while b'\n' in buffer:
   line,buffer=buffer.split(b'\n',1)
   if len(line)>4096:continue
   try:
    data=json.loads(line)
    if isinstance(data,dict) and data.get('event') in ('status','input','network_status','network_scan'):
     events.append({k:v for k,v in data.items() if k in allowed and isinstance(v,(str,int,float,bool)) and (not isinstance(v,str) or len(v)<=128)})
   except (ValueError,UnicodeError):pass
finally:s.close()
print(json.dumps(events[-180:]))
