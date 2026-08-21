"""Turn ORM rows into API responses. Both the public and admin routers use
these, so a field added here appears everywhere at once."""
from .models import Category, Product
from .schemas import CategoryOut, ProductOut


def product_out(product: Product) -> ProductOut:
    return ProductOut(
        id=product.id,
        name=product.name,
        slug=product.slug,
        sku=product.sku,
        short_description=product.short_description,
        description=product.description,
        price=product.price,
        compare_at_price=product.compare_at_price,
        stock=product.stock,
        image_url=product.image_url,
        gallery=[img.url for img in product.images],
        category_id=product.category_id,
        category_name=product.category.name if product.category else None,
        is_active=product.is_active,
        is_featured=product.is_featured,
        in_stock=product.stock > 0,
        created_at=product.created_at,
    )


def category_out(category: Category, product_count: int = 0) -> CategoryOut:
    return CategoryOut(
        id=category.id,
        name=category.name,
        slug=category.slug,
        description=category.description,
        sort_order=category.sort_order,
        is_active=category.is_active,
        product_count=product_count,
    )
