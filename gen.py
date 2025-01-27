def generate_struct_code(struct_name, field_prefix, field_type, num_fields, function_name, initializer):
    # Генерация структуры
    struct_fields = "".join([f"   {field_prefix}{i}: {field_type};\n" for i in range(1, num_fields + 1)])
    struct_code = f"struct {struct_name} {{\n{struct_fields}}}\n\n"

    # Генерация функции
    let_fields = ", ".join([f"{field_prefix}{i}: {initializer}" for i in range(1, num_fields + 1)])
    init_fields = ", ".join([f"{field_prefix}{i}" for i in range(1, num_fields + 1)])
    function_code = (
        f"fun {function_name}(): Int {{\n"
        f"   let s = {struct_name} {{ {let_fields} }};\n"
        f"   return s.a1.beginParse().loadInt(32)\n"
        f"}}\n"
    )

    contract_code = (
        f"\ncontract Test {{"
        f"   get fun bar() {{ {function_name}(); }}"
        f"}}\n"
    )

    # Возвращаем полный код
    return struct_code + function_code + contract_code

# Параметры генерации
struct_name = "Foo"
field_prefix = "a"
field_type = "Cell"
num_fields = 254
initializer = "emptyCell()"
function_name = "foo"

# Генерация кода
code = generate_struct_code(struct_name, field_prefix, field_type, num_fields, function_name, initializer)

# Запись сгенерированного кода в файл
file_path = "/Users/petrmakhnev/tact/src/.testing/test/generated_struct_code.tact"
with open(file_path, "w") as file:
    file.write(code)

print(f"Code saved to {file_path}")
