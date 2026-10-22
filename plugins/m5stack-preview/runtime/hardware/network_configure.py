"""Provision credentials over verified local USB without returning them to chat/logs."""
import json, os, re, stat, sys, time
from pathlib import Path

def prepare(workspace):
    """Create a private editable template, never overwrite or return secrets."""
    workspace=Path(workspace)
    folder=workspace/'.local'
    if folder.is_symlink():raise ValueError('Private configuration directory must not be a symlink')
    folder.mkdir(mode=0o700,exist_ok=True)
    filename=folder/'network-credentials.json'
    if filename.exists() or filename.is_symlink():
        st=filename.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode & 0o077:
            raise ValueError('Existing network configuration must be an owner-only regular file')
        created=False
    else:
        manifest=workspace/'data/network.json'
        if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size>32768:
            raise ValueError('Configure the app services in data/network.json first')
        data=json.loads(manifest.read_text());services=data.get('services')
        if data.get('version')!=1 or not isinstance(services,dict) or not 1<=len(services)<=4:
            raise ValueError('Invalid network services')
        tokens={}
        for name,service in services.items():
            if not re.fullmatch('[A-Za-z0-9_-]{1,32}',name) or not isinstance(service,dict):raise ValueError('Invalid network service')
            if service.get('bearerToken') is True:tokens[name]='ENTER_SERVICE_TOKEN'
        flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)
        fd=os.open(filename,flags,0o600)
        with os.fdopen(fd,'w') as f:json.dump({'wifi':{'ssid':'ENTER_SSID','password':'ENTER_PASSWORD'},'persistOnDevice':True,'tokens':tokens},f,indent=2);f.write('\n')
        created=True
    return {'status':'private_config_created' if created else 'private_config_exists','path':str(filename),'created':created,
            'credentials_returned':False,'next_step':'Open this private file for the user to edit locally, then run network-configure. Do not read its contents into chat.'}

def read_private(filename):
    path=Path(filename)
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
    with os.fdopen(fd) as f:
        st=os.fstat(f.fileno())
        if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or st.st_mode & 0o077 or st.st_size>32768:
            raise ValueError('Private network configuration needs owner-only permissions')
        data=json.load(f)
    wifi=data.get('wifi',{});ssid=wifi.get('ssid');password=wifi.get('password')
    if not isinstance(ssid,str) or not 1<=len(ssid.encode())<=32 or ssid.startswith('ENTER_') or '\0' in ssid:
        raise ValueError('Enter a valid Wi-Fi network in the private configuration file')
    if not isinstance(password,str) or len(password.encode())>64 or '\0' in password or password.startswith('ENTER_'):
        raise ValueError('Enter a valid Wi-Fi password in the private configuration file')
    if type(data.get('persistOnDevice')) is not bool:raise ValueError('Choose persistOnDevice true or false')
    tokens=data.get('tokens',{})
    if not isinstance(tokens,dict) or len(tokens)>4:raise ValueError('Invalid private service token configuration')
    for key,value in tokens.items():
        if not re.fullmatch('[A-Za-z0-9_-]{1,32}',key) or not isinstance(value,str) or value.startswith('ENTER_') or not re.fullmatch('[!-~]{1,1024}',value):
            raise ValueError('Enter valid private service tokens')
    return data

def main():
    port,profile,build,filename=sys.argv[1:]
    forget=filename=='--forget'
    data=None if forget else read_private(filename)
    import serial
    s=serial.Serial(exclusive=True);s.port=port;s.baudrate=115200;s.timeout=.1;s.dtr=True;s.rts=False;s.open()
    buffer=b''
    def exchange(command,predicate):
        nonlocal buffer
        s.write(command.encode()+b'\n');end=time.monotonic()+4
        while time.monotonic()<end:
            buffer+=s.read(4096)
            if len(buffer)>32768:buffer=b''
            while b'\n' in buffer:
                line,buffer=buffer.split(b'\n',1)
                try:r=json.loads(line)
                except (ValueError,UnicodeError):continue
                if isinstance(r,dict) and predicate(r):return r
        raise ValueError('Device did not acknowledge network configuration; no secret details returned')
    try:
        exchange('STATUS',lambda r:r.get('event')=='status' and r.get('profile')==profile and r.get('build')==build and r.get('ready') is True)
        ack=lambda key:lambda r:r.get('event')=='network_config' and r.get('key')==key and r.get('ok') is True
        if forget:
            exchange('NETFORGET',ack('forget'))
            print(json.dumps({'status':'network_forgotten','credentials_returned':False,'local_file_unchanged':True}));return
        exchange('NETTIME '+str(int(time.time())),ack('time'))
        ssid=data['wifi']['ssid'];password=data['wifi']['password'];tokens=data.get('tokens',{})
        persist='1' if data['persistOnDevice'] else '0'
        exchange('NETWIFI '+ssid.encode().hex()+' '+(password.encode().hex() or '-')+' '+persist,ack('wifi'))
        for key,value in tokens.items():exchange('NETTOKEN '+key+' '+value.encode().hex()+' '+persist,ack('token'))
    finally:s.close()
    print(json.dumps({'status':'network_configured','persisted_on_device':data['persistOnDevice'],'token_count':len(tokens),'credentials_returned':False}))

if __name__=='__main__':
    try:main()
    except Exception:
        print(json.dumps({'status':'error','message':'Network configuration failed. Check the private file and the matching running firmware; credentials were not logged.'}));sys.exit(1)
