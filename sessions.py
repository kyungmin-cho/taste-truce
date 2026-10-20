"""Bounded, expiring browser sessions with a persistent per-IP issuance limit."""
import ipaddress
import os
import secrets
import threading
import time
from http import cookies

class Sessions:
    def __init__(self,qloo):
        self.qloo=qloo;self.rows={};self.lock=threading.Lock()
        self.cap=max(1,int(os.getenv('MAX_SESSIONS') or '1000'))
        self.daily=int(os.getenv('IP_DAILY_SESSION_CAP') or '20')
        self.ttl=int(os.getenv('SESSION_TTL_SECONDS') or '86400')

    def ip(self,handler):
        peer=handler.client_address[0]
        header=os.getenv('TRUSTED_PROXY_HEADER','')
        trusted=(os.getenv('TRUSTED_PROXY_IPS') or '').split(',')
        if header and peer in [x.strip() for x in trusted]:
            try:return str(ipaddress.ip_address(handler.headers.get(header,'').split(',')[0].strip()))
            except ValueError:pass
        return peer

    @staticmethod
    def token(header):
        jar=cookies.SimpleCookie()
        try:jar.load(header or '')
        except cookies.CookieError:return ''
        return jar['taste_session'].value if 'taste_session' in jar else ''

    def get(self,token,ip):
        row=self.rows.get(token)
        if row and row['ip']==ip and time.time()-row['at']<self.ttl:return row
        return None

    def issue(self,token,ip):
        with self.lock:
            if self.get(token,ip):return token
            for key,row in list(self.rows.items()):
                if time.time()-row['at']>=self.ttl and not row['mutex'].locked():self.remove(key)
            victim=None
            if len(self.rows)>=self.cap:
                available=[k for k,v in self.rows.items() if not v['mutex'].locked()]
                if not available:raise ValueError('All session slots are busy. Please retry later.')
                victim=min(available,key=lambda k:self.rows[k]['at'])
            if victim:self.remove(victim)
            token=secrets.token_urlsafe(24)
            self.rows[token]={'ip':ip,'at':time.time(),'mutex':threading.Lock(),'counted':False}
            self.qloo.bind_session(token,ip)
            return token

    def remove(self,token):
        self.rows.pop(token,None);self.qloo.forget_session(token)

    def acquire(self,token,ip):
        with self.lock:
            row=self.get(token,ip)
            if not row:return None,'unknown'
            if not row['mutex'].acquire(blocking=False):return None,'busy'
            if not row['counted']:
                if not self.qloo.daily_allow(ip,'sessions',self.daily):
                    row['mutex'].release()
                    return None,'limit'
                row['counted']=True
            return row['mutex'],None
