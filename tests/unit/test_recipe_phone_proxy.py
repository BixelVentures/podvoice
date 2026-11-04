"""Inert HA-boundary checks; no HA instance or network socket is used."""
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from multidict import CIMultiDict


@pytest.mark.asyncio
@pytest.mark.parametrize('payload,status',[
    ({'status':'saved','message':'Gemt: Kage'},200),
    ({'status':'received'},202),
    ({'error':'invalid_recipe_submission'},400),
    ({'error':'recipe_rejected','message':'Kræver gennemgang'},409),
    ({'error':'invalid_recipe','message':'Kan ikke læses'},422),
    ({'message':'Lager utilgængeligt'},503),
])
async def test_ha_relay_always_preserves_or_supplies_feedback(monkeypatch,payload,status):
    class Response:
        content_type='application/json'
        async def __aenter__(self): return self
        async def __aexit__(self,*_): return None
        @property
        def content(self): return self
        async def iter_chunked(self,_): yield json.dumps(payload).encode()
    response=Response()
    response.status=status
    class Session:
        def request(self,*args,**kwargs):
            assert kwargs['allow_redirects'] is False
            assert kwargs['timeout'].total==20
            return response
    for name in ['homeassistant','homeassistant.components','homeassistant.components.http',
                 'homeassistant.core','homeassistant.helpers','homeassistant.helpers.aiohttp_client']:
        monkeypatch.setitem(sys.modules,name,ModuleType(name))
    sys.modules['homeassistant.components.http'].HomeAssistantView=object
    sys.modules['homeassistant.core'].HomeAssistant=object
    sys.modules['homeassistant.helpers.aiohttp_client'].async_get_clientsession=lambda _:Session()
    module_path=Path(__file__).parents[2]/'custom_components/podvoice/recipe_upload.py'
    spec=importlib.util.spec_from_file_location('isolated_recipe_upload',module_path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    request=SimpleNamespace(headers=CIMultiDict(Authorization='Bearer dedicated-test-token'),method='POST')
    result=await module._relay(None,request,'submissions',body=b'{}')
    assert result.status==status
    received=json.loads(result.text)
    assert received['message']
    if payload.get('message'):
        assert received['message']==payload['message']
