//! The small geometry vocabulary layout speaks — in the frontend's own unit
//! (egui: px, a terminal frontend: cells).

/// A 2D extent — also `Size` (the measure answer, a rect's size).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };

    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

impl std::ops::Add for Vec2 {
    type Output = Self;
    fn add(self, o: Self) -> Self {
        Self::new(self.x + o.x, self.y + o.y)
    }
}

impl std::ops::Sub for Vec2 {
    type Output = Self;
    fn sub(self, o: Self) -> Self {
        Self::new(self.x - o.x, self.y - o.y)
    }
}

/// The size a leaf wants — the measure answer.
pub type Size = Vec2;

/// A point.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Pos2 {
    pub x: f32,
    pub y: f32,
}

impl Pos2 {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}

impl std::ops::Add<Vec2> for Pos2 {
    type Output = Self;
    fn add(self, v: Vec2) -> Self {
        Self::new(self.x + v.x, self.y + v.y)
    }
}

/// An axis-aligned box: the rect layout gives a node or a part.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub min: Pos2,
    pub max: Pos2,
}

impl Rect {
    pub fn from_min_size(min: Pos2, size: Vec2) -> Self {
        Self {
            min,
            max: min + size,
        }
    }

    pub fn width(&self) -> f32 {
        self.max.x - self.min.x
    }

    pub fn height(&self) -> f32 {
        self.max.y - self.min.y
    }

    pub fn size(&self) -> Vec2 {
        self.max - self.min
    }

    pub fn translate(&self, v: Vec2) -> Self {
        Self {
            min: self.min + v,
            max: self.max + v,
        }
    }
}

impl std::ops::Sub<Pos2> for Pos2 {
    type Output = Vec2;
    fn sub(self, o: Pos2) -> Vec2 {
        Vec2::new(self.x - o.x, self.y - o.y)
    }
}
