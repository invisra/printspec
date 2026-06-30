from dataclasses import dataclass
from typing import Any
@dataclass
class SupplierReference:
    supplier: str; partNumber: str; url: str|None=None; description: str|None=None
@dataclass
class HardwareItem:
    id: str; kind: str; quantity: int; standard: str|None=None; size: str|None=None; role: str|None=None; supplierReferences: list[SupplierReference]|None=None
class PartFamilySpec(dict): pass
class PrintSpec:
    def __init__(self, **data: Any):
        self.printspecVersion=data.get('printspecVersion','0.1.0'); self.units=data.get('units','mm'); self.part=data.get('part'); self.project=data.get('project'); self.hardware=data.get('hardware'); self.metadata=data.get('metadata')
class ComposablePartSpec(dict): pass
class ProjectSpec(dict): pass
